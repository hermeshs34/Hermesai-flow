import { z } from 'zod';

// Esquema para la posición de nodos
export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// Esquema para configuración de nodos
export const NodeConfigSchema = z.record(z.string(), z.any());

// Esquema para estados de nodos
export const NodeStatusSchema = z.enum(['idle', 'running', 'success', 'error']).optional();

// Esquema para datos de nodos de flujo
export const WorkflowNodeDataSchema = z.object({
  id: z.string().min(1, 'ID del nodo requerido'),
  type: z.enum(['trigger', 'processor', 'output']),
  category: z.string().min(1, 'Categoría requerida'),
  title: z.string().min(1, 'Título requerido'),
  position: PositionSchema,
  config: NodeConfigSchema,
  connections: z.array(z.string()).default([]),
  status: NodeStatusSchema,
  lastRun: z.string().optional(),
  executionCount: z.number().optional().default(0),
});

// Esquema para conexiones
export const WorkflowConnectionSchema = z.object({
  id: z.string().min(1, 'ID de conexión requerido'),
  sourceId: z.string().min(1, 'ID de origen requerido'),
  targetId: z.string().min(1, 'ID de destino requerido'),
});

// Esquema para cronograma
export const ScheduleSchema = z.object({
  type: z.enum(['manual', 'interval', 'cron']),
  value: z.string().optional(),
  interval: z.number().optional(),
}).optional();

// Esquema para estado de flujo
export const WorkflowStatusSchema = z.enum(['active', 'paused', 'error']);

// Esquema principal para flujos de trabajo
export const WorkflowSchema = z.object({
  id: z.string().min(1, 'ID del flujo requerido'),
  name: z.string().min(1, 'Nombre del flujo requerido').min(3, 'Mínimo 3 caracteres'),
  description: z.string().optional(),
  nodes: z.array(WorkflowNodeDataSchema).default([]),
  connections: z.array(WorkflowConnectionSchema).default([]),
  isActive: z.boolean().default(false),
  schedule: ScheduleSchema,
  createdAt: z.string(),
  lastRun: z.string().optional(),
  executionCount: z.number().default(0),
  status: WorkflowStatusSchema.default('paused'),
});

// Esquema para crear workflow (sin id ni timestamps)
export const CreateWorkflowSchema = WorkflowSchema.omit({
  id: true,
  createdAt: true,
  executionCount: true,
});

// Esquema para actualizar workflow
export const UpdateWorkflowSchema = CreateWorkflowSchema.partial();

// Esquema para logs de ejecución
export const ExecutionLogSchema = z.object({
  id: z.string().min(1, 'ID de log requerido'),
  workflowId: z.string().min(1, 'ID de flujo requerido'),
  nodeId: z.string().optional(),
  timestamp: z.string(),
  status: z.enum(['success', 'error', 'warning', 'info']),
  message: z.string().min(1, 'Mensaje requerido'),
  details: z.any().optional(),
  duration: z.number().optional(),
});

// Esquema para configuración de conexión de email
export const EmailConnectionConfigSchema = z.object({
  server: z.string().min(1, 'Servidor requerido'),
  port: z.number().int().min(1).max(65535),
  security: z.enum(['none', 'ssl', 'tls']),
  username: z.string().email('Email inválido'),
  password: z.string().min(1, 'Contraseña requerida'),
});

// Tipos inferidos desde los esquemas
export type Position = z.infer<typeof PositionSchema>;
export type NodeConfig = z.infer<typeof NodeConfigSchema>;
export type WorkflowNodeData = z.infer<typeof WorkflowNodeDataSchema>;
export type WorkflowConnection = z.infer<typeof WorkflowConnectionSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type CreateWorkflow = z.infer<typeof CreateWorkflowSchema>;
export type UpdateWorkflow = z.infer<typeof UpdateWorkflowSchema>;
export type ExecutionLog = z.infer<typeof ExecutionLogSchema>;
export type EmailConnectionConfig = z.infer<typeof EmailConnectionConfigSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type NodeStatus = z.infer<typeof NodeStatusSchema>;
