import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { GridHelper, Plane, Vector3 } from "three";
import { useShallow } from "zustand/react/shallow";
import { useEditorStore } from "../app/store/editorStore";
import type { Node, Segment } from "../domain/toolpath/types";

const TRAVEL_COLOR = "#7d8da1";
const EXTRUSION_COLOR = "#ff8a3d";
const HOVER_COLOR = "#7bc8ff";
const SELECTION_COLOR = "#6effc5";
const PREVIEW_COLOR = "#4df3c8";

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
    beginExtrude,
    cancelExtrude,
    confirmExtrude,
    extrudeSession
  } = useEditorStore(
    useShallow((state) => ({
      selection: state.selection,
      activeTool: state.activeTool,
      beginExtrude: state.beginExtrude,
      cancelExtrude: state.cancelExtrude,
      confirmExtrude: state.confirmExtrude,
      extrudeSession: state.extrudeSession
    }))
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.repeat) {
        return;
      }

      if (event.key.toLowerCase() === "e" && activeTool === "select" && selection.vertexIds.length === 1) {
        event.preventDefault();
        const normal = new Vector3();
        camera.getWorldDirection(normal);
        beginExtrude({ x: normal.x, y: normal.y, z: normal.z });
      }

      if (event.key === "Escape" && extrudeSession) {
        event.preventDefault();
        cancelExtrude();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, beginExtrude, camera, cancelExtrude, extrudeSession, selection.vertexIds]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      if (event.button !== 0 || !extrudeSession) {
        return;
      }

      confirmExtrude();
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [confirmExtrude, extrudeSession]);

  return null;
}

function ExtrudePreviewController(): null {
  const { camera, raycaster, pointer } = useThree();
  const { document, extrudeSession, updateExtrudePreview } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      extrudeSession: state.extrudeSession,
      updateExtrudePreview: state.updateExtrudePreview
    }))
  );

  const plane = useMemo(() => new Plane(), []);
  const intersection = useMemo(() => new Vector3(), []);
  const planeNormal = useMemo(() => new Vector3(), []);
  const source = useMemo(() => new Vector3(), []);

  useFrame(() => {
    if (!extrudeSession) {
      return;
    }

    const sourceNode = document.nodes[extrudeSession.sourceNodeId];
    if (!sourceNode) {
      return;
    }

    source.set(sourceNode.position.x, sourceNode.position.y, sourceNode.position.z);
    planeNormal.set(
      extrudeSession.planeNormal.x,
      extrudeSession.planeNormal.y,
      extrudeSession.planeNormal.z
    );
    plane.setFromNormalAndCoplanarPoint(planeNormal.normalize(), source);
    raycaster.setFromCamera(pointer, camera);

    if (raycaster.ray.intersectPlane(plane, intersection)) {
      updateExtrudePreview({
        x: intersection.x,
        y: intersection.y,
        z: intersection.z
      });
    }
  });

  return null;
}

function Grid(): JSX.Element {
  const grid = useMemo(() => new GridHelper(220, 44, "#244760", "#163042"), []);
  grid.position.set(0, 0, 0);
  return <primitive object={grid} />;
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

function ExtrudePreview(): JSX.Element | null {
  const { document, extrudeSession } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      extrudeSession: state.extrudeSession
    }))
  );

  if (!extrudeSession) {
    return null;
  }

  const sourceNode = document.nodes[extrudeSession.sourceNodeId];
  if (!sourceNode) {
    return null;
  }

  return (
    <>
      <Line
        points={[
          [sourceNode.position.x, sourceNode.position.y, sourceNode.position.z],
          [
            extrudeSession.previewPosition.x,
            extrudeSession.previewPosition.y,
            extrudeSession.previewPosition.z
          ]
        ]}
        color={PREVIEW_COLOR}
        dashed
        dashSize={0.8}
        gapSize={0.45}
        lineWidth={2.4}
      />
      <mesh
        position={[
          extrudeSession.previewPosition.x,
          extrudeSession.previewPosition.y,
          extrudeSession.previewPosition.z
        ]}
      >
        <sphereGeometry args={[0.85, 18, 18]} />
        <meshStandardMaterial color={PREVIEW_COLOR} />
      </mesh>
    </>
  );
}

function ToolpathScene(): JSX.Element {
  const { document, clearSelection, extrudeSession } = useEditorStore(
    useShallow((state) => ({
      document: state.document,
      clearSelection: state.clearSelection,
      extrudeSession: state.extrudeSession
    }))
  );

  return (
    <Canvas
      camera={{ position: [48, 36, 58], fov: 45 }}
      onPointerMissed={() => {
        if (!extrudeSession) {
          clearSelection();
        }
      }}
    >
      <color attach="background" args={["#09111a"]} />
      <fog attach="fog" args={["#09111a", 90, 180]} />
      <ambientLight intensity={1} />
      <directionalLight intensity={1.4} position={[14, 28, 18]} />
      <Grid />
      <axesHelper args={[20]} />
      <SceneInteractions />
      <ExtrudePreviewController />
      <OrbitControls makeDefault enabled={!extrudeSession} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
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
              startNode={startNode}
              endNode={endNode}
            />
          );
        })}

        {Object.values(document.nodes).map((node) => (
          <VertexHandle key={node.id} nodeId={node.id} position={node.position} />
        ))}

        <ExtrudePreview />
      </group>
    </Canvas>
  );
}

export function Viewport(): JSX.Element {
  return <ToolpathScene />;
}
