/**
 * FlowCanvas - Visual workflow canvas with draggable nodes
 */
import { useState, useRef, useCallback } from 'react';
import FlowNode from './FlowNode';
import { Button } from '@/components/ui/button';
import { Play, Save, Trash2 } from 'lucide-react';

export interface CanvasNode {
  id: string;
  type: 'trigger' | 'condition' | 'action' | 'approval' | 'delay';
  subtype: string;
  label: string;
  x: number;
  y: number;
  config?: Record<string, any>;
}

export interface NodeConnection {
  from: string;
  to: string;
  label?: string;
}

interface FlowCanvasProps {
  nodes: CanvasNode[];
  connections: NodeConnection[];
  onNodesChange: (nodes: CanvasNode[]) => void;
  onConnectionsChange: (conns: NodeConnection[]) => void;
  onSelectNode: (node: CanvasNode | null) => void;
  selectedNodeId?: string | null;
  onTestRun?: () => void;
  onSave?: () => void;
}

export default function FlowCanvas({
  nodes,
  connections,
  onNodesChange,
  onConnectionsChange,
  onSelectNode,
  selectedNodeId,
  onTestRun,
  onSave,
}: FlowCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDraggingId(nodeId);
      setDragOffset({
        x: e.clientX - rect.left - node.x,
        y: e.clientY - rect.top - node.y,
      });
    },
    [nodes]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setMousePos({ x, y });

      if (draggingId) {
        const newX = Math.max(0, x - dragOffset.x);
        const newY = Math.max(0, y - dragOffset.y);
        onNodesChange(
          nodes.map((n) =>
            n.id === draggingId ? { ...n, x: newX, y: newY } : n
          )
        );
      }
    },
    [draggingId, dragOffset, nodes, onNodesChange]
  );

  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
  }, []);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (connectingFrom) {
        if (connectingFrom !== nodeId) {
          const exists = connections.some(
            (c) => c.from === connectingFrom && c.to === nodeId
          );
          if (!exists) {
            onConnectionsChange([...connections, { from: connectingFrom, to: nodeId }]);
          }
        }
        setConnectingFrom(null);
      } else {
        const node = nodes.find((n) => n.id === nodeId) || null;
        onSelectNode(node);
      }
    },
    [connectingFrom, connections, nodes, onConnectionsChange, onSelectNode]
  );

  const handleNodeRightClick = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      setConnectingFrom(nodeId);
    },
    []
  );

  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId) return;
    onNodesChange(nodes.filter((n) => n.id !== selectedNodeId));
    onConnectionsChange(
      connections.filter(
        (c) => c.from !== selectedNodeId && c.to !== selectedNodeId
      )
    );
    onSelectNode(null);
  }, [selectedNodeId, nodes, connections, onNodesChange, onConnectionsChange, onSelectNode]);

  const getConnectionPath = (from: CanvasNode, to: CanvasNode): string => {
    const fx = from.x + 100;
    const fy = from.y + 30;
    const tx = to.x + 100;
    const ty = to.y + 30;
    const mx = (fx + tx) / 2;
    return `M ${fx} ${fy} C ${mx} ${fy}, ${mx} ${ty}, ${tx} ${ty}`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#e5e0d5] bg-white">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8a8a8a]">
            {connectingFrom
              ? 'Click another node to connect...'
              : 'Right-click node to connect - Drag to move'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedNodeId && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteNode}
              className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50"
            >
              <Trash2 className="w-3 h-3 mr-1" />
              Delete
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            className="h-7 text-xs border-[#e5e0d5] text-[#595959] hover:bg-[#f5f2eb]"
          >
            <Save className="w-3 h-3 mr-1" />
            Save
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onTestRun}
            className="h-7 text-xs border-[#c9a87c] text-[#c9a87c] hover:bg-[#c9a87c]/10"
          >
            <Play className="w-3 h-3 mr-1" />
            Test Run
          </Button>
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative flex-1 bg-[#fbf9f4] overflow-hidden"
        style={{
          backgroundImage:
            'radial-gradient(circle, #e5e0d5 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Connection lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {connections.map((conn, idx) => {
            const fromNode = nodes.find((n) => n.id === conn.from);
            const toNode = nodes.find((n) => n.id === conn.to);
            if (!fromNode || !toNode) return null;
            return (
              <g key={idx}>
                <path
                  d={getConnectionPath(fromNode, toNode)}
                  fill="none"
                  stroke="#c9a87c"
                  strokeWidth={2}
                  strokeDasharray="0"
                />
                <circle cx={toNode.x + 100} cy={toNode.y + 30} r={3} fill="#c9a87c" />
              </g>
            );
          })}
          {connectingFrom && (
            <path
              d={`M ${nodes.find((n) => n.id === connectingFrom)!.x + 100} ${
                nodes.find((n) => n.id === connectingFrom)!.y + 30
              } L ${mousePos.x} ${mousePos.y}`}
              fill="none"
              stroke="#c9a87c"
              strokeWidth={2}
              strokeDasharray="5,5"
            />
          )}
        </svg>

        {/* Nodes */}
        {nodes.map((node) => (
          <div
            key={node.id}
            style={{
              position: 'absolute',
              left: node.x,
              top: node.y,
              width: 200,
              zIndex: draggingId === node.id ? 10 : 1,
            }}
            onMouseDown={(e) => handleMouseDown(e, node.id)}
            onClick={() => handleNodeClick(node.id)}
            onContextMenu={(e) => handleNodeRightClick(e, node.id)}
          >
            <FlowNode
              node={node}
              isSelected={selectedNodeId === node.id}
              isConnecting={connectingFrom === node.id}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
