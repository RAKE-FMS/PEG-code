import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type ElementRef, type RefObject, useEffect, useMemo, useRef } from "react";
import {
  GridHelper,
  Group,
  MOUSE,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  TOUCH,
  Vector3
} from "three";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "../app/store/editorStore";
import { addVector, dotVector, normalizeVector, subtractVector } from "../domain/toolpath/math";
import { getExtrudeInsertionIndex } from "../domain/toolpath/extrude";
import type { Node, Segment } from "../domain/toolpath/types";

const TRAVEL_COLOR = "#7d8da1";
const EXTRUSION_COLOR = "#ff8a3d";
const HOVER_COLOR = "#7bc8ff";
const SELECTION_COLOR = "#6effc5";
const PREVIEW_COLOR = "#4df3c8";
const AXIS_X_COLOR = "#ff4d4f";
const AXIS_Y_COLOR = "#52c41a";
const AXIS_Z_COLOR = "#1677ff";
const INFINITE_AXIS_LENGTH = 100000;
const TRACKPAD_ROTATE_SPEED = 0.005;
const ZOOM_DOLLY_SCALE = 0.985;
const MOUSE_DISABLED = -1 as MOUSE;
type OrbitControlsInstance = ElementRef<typeof OrbitControls>;

function useSelectionColors(segment: Segment, hovered: boolean, selected: boolean): string {
  if (selected) return SELECTION_COLOR;
  if (hovered) return HOVER_COLOR;
  return segment.isTravel ? TRAVEL_COLOR : EXTRUSION_COLOR;
}

function SceneInteractions(): null {
  const camera = useThree((state) => state.camera);
  const {
    selection,
    activeTool,
    beginMove,
    beginExtrude,
    cancelTransform,
    confirmTransform,
    deleteSelectedVertices,
    setTransformAxisLock,
    appendTransformNumericInput,
    backspaceTransformNumericInput,
    transformSession,
    undo,
    redo
  } = useEditorStore(
    useShallow((state) => ({
      selection: state.selection,
      activeTool: state.activeTool,
      beginMove: state.beginMove,
      beginExtrude: state.beginExtrude,
      cancelTransform: state.cancelTransform,
      confirmTransform: state.confirmTransform,
      deleteSelectedVertices: state.deleteSelectedVertices,
      setTransformAxisLock: state.setTransformAxisLock,
      appendTransformNumericInput: state.appendTransformNumericInput,
      backspaceTransformNumericInput: state.backspaceTransformNumericInput,
      transformSession: state.transformSession,
      undo: state.undo,
      redo: state.redo
    }))
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      const isUndoModifier = event.ctrlKey || event.metaKey;

      if (isUndoModifier && !event.altKey && event.key.toLowerCase() === "z") {
        event.preventDefault();

        if (transformSession) {
          cancelTransform();
          return;
        }

        if (event.shiftKey) {
          redo();
          return;
        }

        undo();
        return;
      }

      if (event.repeat) {
        return;
      }

      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        /^[0-9.-]$/.test(event.key) &&
        transformSession
      ) {
        event.preventDefault();
        appendTransformNumericInput(event.key);
        return;
      }

      if (event.key === "Backspace" && transformSession) {
        event.preventDefault();
        backspaceTransformNumericInput();
        return;
      }

      if (event.key === "Enter" && transformSession) {
        event.preventDefault();
        confirmTransform();
        return;
      }

      if (["x", "y", "z"].includes(event.key.toLowerCase()) && transformSession) {
        event.preventDefault();
        setTransformAxisLock(event.key.toLowerCase() as "x" | "y" | "z");
        return;
      }

      if (event.key.toLowerCase() === "g" && activeTool === "select" && selection.vertexIds.length > 0) {
        event.preventDefault();
        const normal = new Vector3();
        camera.getWorldDirection(normal);
        beginMove({ x: normal.x, y: normal.y, z: normal.z });
        return;
      }

      if (event.key.toLowerCase() === "e" && activeTool === "select" && selection.vertexIds.length === 1) {
        event.preventDefault();
        const normal = new Vector3();
        camera.getWorldDirection(normal);
        beginExtrude({ x: normal.x, y: normal.y, z: normal.z });
        return;
      }

      if (
        ["Backspace", "Delete"].includes(event.key) &&
        !transformSession &&
        selection.vertexIds.length > 0
      ) {
        event.preventDefault();
        deleteSelectedVertices();
        return;
      }

      if (event.key === "Escape" && transformSession) {
        event.preventDefault();
        cancelTransform();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeTool,
    appendTransformNumericInput,
    backspaceTransformNumericInput,
    beginExtrude,
    beginMove,
    camera,
    cancelTransform,
    confirmTransform,
    deleteSelectedVertices,
    selection.vertexIds,
    setTransformAxisLock,
    transformSession,
    undo,
    redo
  ]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (event.button !== 0 || !transformSession) {
        return;
      }

      confirmTransform();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [confirmTransform, transformSession]);

  return null;
}

function ExtrudePreviewController({
  toolpathGroupRef
}: {
  toolpathGroupRef: RefObject<Group>;
}): null {
  const { camera, raycaster, pointer } = useThree();
  const { document, transformSession, updateTransformPreview } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      transformSession: state.transformSession,
      updateTransformPreview: state.updateTransformPreview
    }))
  );

  const plane = useMemo(() => new Plane(), []);
  const intersection = useMemo(() => new Vector3(), []);
  const planeNormal = useMemo(() => new Vector3(), []);
  const source = useMemo(() => new Vector3(), []);
  const worldIntersection = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (!transformSession) {
      return;
    }

    if (transformSession.numericInput.length > 0) {
      return;
    }

    const sourceNode = document.nodes[transformSession.sourceNodeId];
    if (!sourceNode) {
      return;
    }

    source.set(sourceNode.position.x, sourceNode.position.y, sourceNode.position.z);
    const toolpathGroup = toolpathGroupRef.current;
    if (!toolpathGroup) {
      return;
    }

    toolpathGroup.updateWorldMatrix(true, false);
    toolpathGroup.localToWorld(source);
    planeNormal.set(
      transformSession.planeNormal.x,
      transformSession.planeNormal.y,
      transformSession.planeNormal.z
    );
    plane.setFromNormalAndCoplanarPoint(planeNormal.normalize(), source);
    raycaster.setFromCamera(pointer, camera);

    if (raycaster.ray.intersectPlane(plane, worldIntersection)) {
      intersection.copy(worldIntersection);
      toolpathGroup.worldToLocal(intersection);
      const rawOffset = subtractVector(intersection, sourceNode.position);

      if (transformSession.axisLock) {
        const axisVector =
          transformSession.axisLock === "x"
            ? { x: 1, y: 0, z: 0 }
            : transformSession.axisLock === "y"
              ? { x: 0, y: 1, z: 0 }
              : { x: 0, y: 0, z: 1 };
        const amount = dotVector(rawOffset, normalizeVector(axisVector));
        updateTransformPreview({
          x: transformSession.axisLock === "x" ? amount : 0,
          y: transformSession.axisLock === "y" ? amount : 0,
          z: transformSession.axisLock === "z" ? amount : 0
        });
        return;
      }

      updateTransformPreview(rawOffset);
    }
  });

  return null;
}

function Grid(): JSX.Element {
  const grid = useMemo(() => new GridHelper(220, 44, "#244760", "#163042"), []);
  grid.position.set(0, 0, 0);
  return <primitive object={grid} />;
}

function InfiniteAxes(): JSX.Element {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <Line
        points={[
          [-INFINITE_AXIS_LENGTH, 0, 0],
          [INFINITE_AXIS_LENGTH, 0, 0]
        ]}
        color={AXIS_X_COLOR}
        lineWidth={1.8}
      />
      <Line
        points={[
          [0, -INFINITE_AXIS_LENGTH, 0],
          [0, INFINITE_AXIS_LENGTH, 0]
        ]}
        color={AXIS_Y_COLOR}
        lineWidth={1.8}
      />
      <Line
        points={[
          [0, 0, -INFINITE_AXIS_LENGTH],
          [0, 0, INFINITE_AXIS_LENGTH]
        ]}
        color={AXIS_Z_COLOR}
        lineWidth={1.8}
      />
    </group>
  );
}

function isZoomWheelEvent(event: WheelEvent): boolean {
  if (event.ctrlKey || event.metaKey) {
    return true;
  }

  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
    return true;
  }

  const legacyWheelDelta = Math.abs(
    (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0
  );

  return Math.abs(event.deltaX) === 0 && (legacyWheelDelta === 120 || legacyWheelDelta === 100);
}

function panPerspectiveCamera(
  controls: OrbitControlsInstance,
  camera: PerspectiveCamera,
  deltaX: number,
  deltaY: number
): void {
  const element = controls.domElement;
  if (!element) {
    return;
  }

  const offset = new Vector3().subVectors(camera.position, controls.target);
  const targetDistance = offset.length() * Math.tan((camera.fov * Math.PI) / 360);
  const panX = (2 * deltaX * targetDistance) / element.clientHeight;
  const panY = (-2 * deltaY * targetDistance) / element.clientHeight;
  const panOffset = new Vector3();

  panOffset.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(panX);
  panOffset.add(new Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(panY));

  camera.position.add(panOffset);
  controls.target.add(panOffset);
}

function panOrthographicCamera(
  controls: OrbitControlsInstance,
  camera: OrthographicCamera,
  deltaX: number,
  deltaY: number
): void {
  const element = controls.domElement;
  if (!element) {
    return;
  }

  const panX = (deltaX * (camera.right - camera.left)) / camera.zoom / element.clientWidth;
  const panY = (-deltaY * (camera.top - camera.bottom)) / camera.zoom / element.clientHeight;
  const panOffset = new Vector3();

  panOffset.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(panX);
  panOffset.add(new Vector3().setFromMatrixColumn(camera.matrix, 1).multiplyScalar(panY));

  camera.position.add(panOffset);
  controls.target.add(panOffset);
}

function rotateCamera(controls: OrbitControlsInstance, deltaX: number, deltaY: number): void {
  const nextAzimuthalAngle = controls.getAzimuthalAngle() + deltaX * TRACKPAD_ROTATE_SPEED;
  const nextPolarAngle = controls.getPolarAngle() + deltaY * TRACKPAD_ROTATE_SPEED;
  const clampedPolarAngle = Math.min(
    controls.maxPolarAngle,
    Math.max(controls.minPolarAngle, nextPolarAngle)
  );

  controls.setAzimuthalAngle(nextAzimuthalAngle);
  controls.setPolarAngle(clampedPolarAngle);
}

function setMiddleMouseMode(controls: OrbitControlsInstance, usePan: boolean): void {
  controls.mouseButtons.LEFT = MOUSE_DISABLED;
  controls.mouseButtons.MIDDLE = usePan ? MOUSE.PAN : MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = MOUSE.PAN;
}

function ViewportControls({ enabled }: { enabled: boolean }): JSX.Element {
  const controlsRef = useRef<OrbitControlsInstance | null>(null);

  useEffect(() => {
    const controls = controlsRef.current;
    const element = controls?.domElement;
    if (!controls || !element) {
      return;
    }

    setMiddleMouseMode(controls, false);

    function handleKeyChange(event: KeyboardEvent): void {
      const activeControls = controlsRef.current;
      if (!activeControls) {
        return;
      }

      setMiddleMouseMode(activeControls, event.shiftKey);
    }

    function handleWheel(event: WheelEvent): void {
      const activeControls = controlsRef.current;
      if (!enabled || !activeControls) {
        return;
      }

      event.preventDefault();

      if (isZoomWheelEvent(event) && event.deltaY < 0) {
        activeControls.dollyIn(ZOOM_DOLLY_SCALE);
      } else if (isZoomWheelEvent(event) && event.deltaY > 0) {
        activeControls.dollyOut(ZOOM_DOLLY_SCALE);
      } else if (event.shiftKey) {
        if (activeControls.object instanceof PerspectiveCamera) {
          panPerspectiveCamera(activeControls, activeControls.object, event.deltaX, event.deltaY);
        } else if (activeControls.object instanceof OrthographicCamera) {
          panOrthographicCamera(activeControls, activeControls.object, event.deltaX, event.deltaY);
        }
      } else {
        rotateCamera(activeControls, event.deltaX, event.deltaY);
      }

      activeControls.update();
    }

    function handleWindowBlur(): void {
      const activeControls = controlsRef.current;
      if (!activeControls) {
        return;
      }

      setMiddleMouseMode(activeControls, false);
    }

    window.addEventListener("keydown", handleKeyChange);
    window.addEventListener("keyup", handleKeyChange);
    window.addEventListener("blur", handleWindowBlur);
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", handleKeyChange);
      window.removeEventListener("keyup", handleKeyChange);
      window.removeEventListener("blur", handleWindowBlur);
      element.removeEventListener("wheel", handleWheel);
    };
  }, [enabled]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enabled={enabled}
      enableZoom={false}
      mouseButtons={{
        LEFT: MOUSE_DISABLED,
        MIDDLE: MOUSE.ROTATE,
        RIGHT: MOUSE.PAN
      }}
      touches={{
        ONE: TOUCH.ROTATE,
        TWO: TOUCH.DOLLY_PAN
      }}
    />
  );
}

function SegmentLine({ segment, startNode, endNode }: { segment: Segment; startNode: Node; endNode: Node }): JSX.Element {
  const { hoverTarget, selection, setHoverTarget, clearHoverTarget, selectSegment } = useEditorStore(
    useShallow((state) => ({
      hoverTarget: state.hoverTarget,
      selection: state.selection,
      setHoverTarget: state.setHoverTarget,
      clearHoverTarget: state.clearHoverTarget,
      selectSegment: state.selectSegment
    }))
  );

  const selected = selection.segmentIds.includes(segment.id);
  const hovered = hoverTarget?.type === "segment" && hoverTarget.id === segment.id;
  const color = useSelectionColors(segment, hovered, selected);

  return (
    <Line
      points={[
        [startNode.position.x, startNode.position.y, startNode.position.z],
        [endNode.position.x, endNode.position.y, endNode.position.z]
      ]}
      color={color}
      lineWidth={selected ? 3.6 : hovered ? 3 : 2.25}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHoverTarget({ type: "segment", id: segment.id });
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        clearHoverTarget();
      }}
      onClick={(event) => {
        event.stopPropagation();
        selectSegment(segment.id, event.shiftKey);
      }}
    />
  );
}

function VertexHandle({ nodeId, position }: { nodeId: string; position: Node["position"] }): JSX.Element {
  const { hoverTarget, selection, setHoverTarget, clearHoverTarget, selectVertex } = useEditorStore(
    useShallow((state) => ({
      hoverTarget: state.hoverTarget,
      selection: state.selection,
      setHoverTarget: state.setHoverTarget,
      clearHoverTarget: state.clearHoverTarget,
      selectVertex: state.selectVertex
    }))
  );

  const selected = selection.vertexIds.includes(nodeId);
  const hovered = hoverTarget?.type === "vertex" && hoverTarget.id === nodeId;

  return (
    <mesh
      position={[position.x, position.y, position.z]}
      onPointerOver={(event) => {
        event.stopPropagation();
        setHoverTarget({ type: "vertex", id: nodeId });
      }}
      onPointerOut={(event) => {
        event.stopPropagation();
        clearHoverTarget();
      }}
      onClick={(event) => {
        event.stopPropagation();
        selectVertex(nodeId, event.shiftKey);
      }}
    >
      <sphereGeometry args={[selected ? 0.95 : hovered ? 0.8 : 0.65, 18, 18]} />
      <meshStandardMaterial
        color={selected ? SELECTION_COLOR : hovered ? HOVER_COLOR : "#dbe7f2"}
        emissive={selected ? SELECTION_COLOR : "#000000"}
        emissiveIntensity={selected ? 0.25 : 0}
      />
    </mesh>
  );
}

function TransformPreview(): JSX.Element | null {
  const { document, selection, transformSession } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      selection: state.selection,
      transformSession: state.transformSession
    }))
  );

  if (!transformSession) {
    return null;
  }

  const sourceNode = document.nodes[transformSession.sourceNodeId];
  if (!sourceNode) {
    return null;
  }

  const previewPosition = addVector(sourceNode.position, transformSession.previewOffset);

  if (transformSession.mode === "move") {
    return (
      <>
        {transformSession.nodeIds.map((nodeId) => {
          const node = document.nodes[nodeId];
          if (!node) {
            return null;
          }

          const movedPosition = addVector(node.position, transformSession.previewOffset);
          return (
            <Line
              key={`move-preview-${nodeId}`}
              points={[
                [node.position.x, node.position.y, node.position.z],
                [movedPosition.x, movedPosition.y, movedPosition.z]
              ]}
              color={PREVIEW_COLOR}
              dashed
              dashSize={0.8}
              gapSize={0.45}
              lineWidth={2.1}
            />
          );
        })}
        {selection.vertexIds.map((nodeId) => {
          const node = document.nodes[nodeId];
          if (!node) {
            return null;
          }

          const movedPosition = addVector(node.position, transformSession.previewOffset);
          return (
            <mesh key={`move-node-${nodeId}`} position={[movedPosition.x, movedPosition.y, movedPosition.z]}>
              <sphereGeometry args={[0.85, 18, 18]} />
              <meshStandardMaterial color={PREVIEW_COLOR} />
            </mesh>
          );
        })}
      </>
    );
  }

  const insertionIndex = getExtrudeInsertionIndex(document, transformSession.sourceNodeId);
  const followingSegment = document.segments[insertionIndex];
  const followingNode = followingSegment
    ? document.nodes[followingSegment.endNodeId]
    : null;

  return (
    <>
      <Line
        points={[
          [sourceNode.position.x, sourceNode.position.y, sourceNode.position.z],
          [previewPosition.x, previewPosition.y, previewPosition.z]
        ]}
        color={PREVIEW_COLOR}
        dashed
        dashSize={0.8}
        gapSize={0.45}
        lineWidth={2.4}
      />
      {followingNode ? (
        <Line
          points={[
            [previewPosition.x, previewPosition.y, previewPosition.z],
            [followingNode.position.x, followingNode.position.y, followingNode.position.z]
          ]}
          color={PREVIEW_COLOR}
          dashed
          dashSize={0.8}
          gapSize={0.45}
          lineWidth={2.1}
        />
      ) : null}
      <mesh
        position={[previewPosition.x, previewPosition.y, previewPosition.z]}
      >
        <sphereGeometry args={[0.85, 18, 18]} />
        <meshStandardMaterial color={PREVIEW_COLOR} />
      </mesh>
    </>
  );
}

function ToolpathScene(): JSX.Element {
  const { document, clearSelection, transformSession } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      clearSelection: state.clearSelection,
      transformSession: state.transformSession
    }))
  );
  const toolpathGroupRef = useRef<Group | null>(null);
  const previewOffset = transformSession?.mode === "move" ? transformSession.previewOffset : null;

  function resolveNodePosition(node: Node): Node["position"] {
    if (!previewOffset || !transformSession?.nodeIds.includes(node.id)) {
      return node.position;
    }

    return addVector(node.position, previewOffset);
  }

  return (
    <Canvas
      camera={{ position: [48, 36, 58], fov: 45 }}
      onPointerMissed={() => {
        if (!transformSession) {
          clearSelection();
        }
      }}
    >
      <color attach="background" args={["#09111a"]} />
      <fog attach="fog" args={["#09111a", 90, 180]} />
      <ambientLight intensity={1} />
      <directionalLight intensity={1.4} position={[14, 28, 18]} />
      <Grid />
      <InfiniteAxes />
      <SceneInteractions />
      <ExtrudePreviewController toolpathGroupRef={toolpathGroupRef} />
      <ViewportControls enabled={!transformSession} />
      <group ref={toolpathGroupRef} rotation={[-Math.PI / 2, 0, 0]}>
        {document.segments.map((segment) => {
          const startNode = document.nodes[segment.startNodeId];
          const endNode = document.nodes[segment.endNodeId];

          if (!startNode || !endNode) {
            return null;
          }

          return (
            <SegmentLine
              key={segment.id}
              segment={segment}
              startNode={{ ...startNode, position: resolveNodePosition(startNode) }}
              endNode={{ ...endNode, position: resolveNodePosition(endNode) }}
            />
          );
        })}

        {Object.values(document.nodes).map((node) => (
          <VertexHandle key={node.id} nodeId={node.id} position={resolveNodePosition(node)} />
        ))}

        <TransformPreview />
      </group>
    </Canvas>
  );
}

export function Viewport(): JSX.Element {
  return <ToolpathScene />;
}
