# ROADMAP.md — HermesAI Flow

## Estado General — Mayo 2026

| Fase | Descripción | Estado |
|------|-------------|--------|
| F0 | Fundaciones: Supabase, auth multi-tenant, estructura, CLAUDE.md | 🔄 En curso |
| F1 | Motor de ejecución: Edge Functions, nodo Email/Resend, nodo BCV | ⏳ Pendiente |
| F2 | Conectores 4 sistemas: RiskGuard, EE.FF., Indicadores, LegalTech | ⏳ Pendiente |
| F3 | Agente IA: informes automáticos por dominio con Claude | ⏳ Pendiente |
| F4 | Alertas inteligentes: umbrales, escalamiento, multi-canal | ⏳ Pendiente |
| F5 | QA, hardening, go-live | ⏳ Pendiente |

---

## F0 — Fundaciones (En curso)

### Completado
- [x] Estructura de carpetas estándar HermesAI
- [x] CLAUDE.md con arquitectura completa
- [x] package.json limpio (sin dependencias Node.js-only)
- [x] .gitignore y .env.example

### Pendiente F0
- [ ] Crear proyecto Supabase en dashboard
- [ ] Schema SQL inicial (organizations, profiles, workflows, nodes, connections, execution_logs, integrations)
- [ ] Políticas RLS por tabla
- [ ] Auth: login, multi-tenant, roles
- [ ] Canvas visual refactorizado (persistencia Supabase en vez de localStorage)
- [ ] Deploy Netlify inicial

---

## Referencia histórica Bolt.new (Diciembre 2025)
## Versión Actual: 1.0 (Fase 1 - Completada ✅)

---

## 📍 FASE 1: Arquitectura Base (COMPLETADA ✅)

### Objetivos Alcanzados
- ✅ State Management (Zustand)
- ✅ Validación de Datos (Zod)
- ✅ Notificaciones (Sonner)
- ✅ Custom Hooks (4 principales)
- ✅ Servicios Async/Await
- ✅ Documentación completa
- ✅ TypeScript 100%

### Archivos Entregables
- ✅ `src/store/workflowStore.ts`
- ✅ `src/hooks/useWorkflow.ts`
- ✅ `src/types/validationSchemas.ts`
- ✅ `src/utils/toast.ts`
- ✅ `src/utils/helpers.ts`
- ✅ Documentación (4 archivos)

**Status**: 🟢 COMPLETADO

---

## 📍 FASE 2: Frontend Avanzado (2-3 SEMANAS)

### 2.1 Refactorizar Componentes
**Objetivo**: Usar nuevos hooks en todos los componentes

#### Tareas
- [ ] Dashboard → useWorkflows() + useWorkflowExecution()
- [ ] WorkflowCanvas → useWorkflow() + Zustand
- [ ] NodeConfigPanel → useWorkflow() + Validación Zod
- [ ] Monitoring → useExecutionLogs()
- [ ] Settings → useWorkflowStore()

**Estimado**: 1 semana

### 2.2 Testing
**Objetivo**: 70%+ cobertura de tests

#### Librerías
```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom
```

#### Tests a crear
- [ ] `useWorkflows.test.ts` - Cargar/crear/editar workflows
- [ ] `useWorkflow.test.ts` - Nodos y conexiones
- [ ] `workflowService.test.ts` - Servicios
- [ ] Componentes principales

**Estimado**: 1 semana

### 2.3 Error Handling
**Objetivo**: Capturar y reportar errores mejor

#### Tareas
- [ ] Error Boundary componente
- [ ] Logging centralizado (Winston)
- [ ] Global error handler
- [ ] Retry automático en fallos de red

**Estimado**: 3-4 días

**Deliverables Fase 2**: 
- Componentes 100% refactorizados
- Tests pasando
- Error handling robusto

**Status**: 🟡 PRÓXIMO

---

## 📍 FASE 3: Backend e Integración (3-4 SEMANAS)

### 3.1 API Backend
**Objetivo**: Servidor Node.js/Express con endpoints reales

#### Estructura Backend
```
backend/
├── src/
│   ├── routes/
│   │   ├── workflows.ts
│   │   ├── nodes.ts
│   │   ├── connections.ts
│   │   └── executions.ts
│   ├── controllers/
│   ├── services/
│   ├── middleware/
│   ├── db/
│   │   ├── migrations/
│   │   └── schemas.sql
│   └── types/
├── tsconfig.json
└── .env
```

#### Endpoints
```
GET    /api/workflows
POST   /api/workflows
GET    /api/workflows/:id
PUT    /api/workflows/:id
DELETE /api/workflows/:id
POST   /api/workflows/:id/execute
GET    /api/workflows/:id/logs
```

**Estimado**: 1.5 semanas

### 3.2 Base de Datos
**Objetivo**: PostgreSQL con Supabase

#### Tablas
```sql
CREATE TABLE workflows (
  id uuid PRIMARY KEY,
  name varchar(255) NOT NULL,
  description text,
  created_at timestamp,
  updated_at timestamp,
  user_id uuid NOT NULL
);

CREATE TABLE workflow_nodes (
  id uuid PRIMARY KEY,
  workflow_id uuid REFERENCES workflows,
  type varchar(50),
  title varchar(255),
  position_x int,
  position_y int,
  config jsonb
);

CREATE TABLE workflow_connections (
  id uuid PRIMARY KEY,
  workflow_id uuid REFERENCES workflows,
  source_id uuid REFERENCES workflow_nodes,
  target_id uuid REFERENCES workflow_nodes
);

CREATE TABLE execution_logs (
  id uuid PRIMARY KEY,
  workflow_id uuid REFERENCES workflows,
  node_id uuid REFERENCES workflow_nodes,
  timestamp timestamp,
  status varchar(50),
  message text,
  duration int
);
```

**Estimado**: 1 semana

### 3.3 Autenticación
**Objetivo**: OAuth con Supabase Auth

#### Tareas
- [ ] Configurar Supabase Auth
- [ ] Login con Google/GitHub
- [ ] Middleware de autenticación
- [ ] Role-based access control (RBAC)
- [ ] JWT tokens

**Estimado**: 1 semana

**Deliverables Fase 3**:
- Backend REST completamente funcional
- Base de datos PostgreSQL
- Autenticación OAuth
- Sincronización frontend-backend

**Status**: 🟡 FUTURO

---

## 📍 FASE 4: Workers y Escalabilidad (4-6 SEMANAS)

### 4.1 Workers para Ejecutar Workflows
**Objetivo**: Procesar workflows en background

#### Stack
```bash
npm install bull redis
npm install -D @types/bull
```

#### Archivos
```
backend/
├── workers/
│   ├── workflowExecutor.ts
│   ├── emailWorker.ts
│   ├── scrapingWorker.ts
│   └── aiWorker.ts
└── queues/
    └── workflowQueue.ts
```

#### Características
- ✅ Colas de trabajos (Bull)
- ✅ Redis como mensaje broker
- ✅ Reintentos automáticos
- ✅ Logs de ejecución
- ✅ Webhooks para notificaciones

**Estimado**: 2 semanas

### 4.2 Logging Centralizado
**Objetivo**: Logs estructurados con Winston

#### Ejemplo
```typescript
logger.info('Workflow ejecutado', {
  workflowId,
  duration,
  nodesExecuted,
  timestamp
});
```

**Estimado**: 3-4 días

### 4.3 Monitoreo y Métricas
**Objetivo**: Sentry + Grafana

#### Tareas
- [ ] Integrar Sentry
- [ ] Error tracking en producción
- [ ] Performance monitoring
- [ ] Dashboards Grafana

**Estimado**: 1 semana

**Deliverables Fase 4**:
- Sistema de workers distribuido
- Logging centralizado
- Monitoreo en tiempo real
- Escalabilidad horizontalmente

**Status**: 🟡 FUTURO

---

## 📍 FASE 5: DevOps y Producción (2-3 SEMANAS)

### 5.1 CI/CD Pipeline
**Objetivo**: GitHub Actions

```yaml
# Ejemplo workflow
name: CI/CD
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - run: npm install
      - run: npm run test
      - run: npm run typecheck
      - run: npm run lint
```

**Estimado**: 1 semana

### 5.2 Deployment
**Objetivo**: Deploy en producción

#### Opciones
- Frontend: Vercel / Netlify
- Backend: Railway / Render / AWS
- DB: Supabase / AWS RDS
- Workers: AWS Lambda / Azure Functions

**Estimado**: 1 semana

### 5.3 Docker
**Objetivo**: Containerización

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

**Estimado**: 3-4 días

**Deliverables Fase 5**:
- CI/CD completamente automático
- Deploy en 1 comando
- Versionado y rollback
- Monitoreo de deployments

**Status**: 🟡 FUTURO

---

## 📍 FASE 6: Features Avanzadas (4-6 SEMANAS)

### 6.1 Workflow Templates
- Plantillas predefinidas
- Marketplace de workflows
- Compartir workflows entre usuarios

### 6.2 Integraciones Externas
- Zapier-like integration
- Webhooks
- API pública

### 6.3 Colaboración en Tiempo Real
- WebSockets
- Cursores compartidos
- Comments en workflows

### 6.4 Mobile App
- React Native
- Reutilizar hooks y store
- PWA version

**Status**: 🟡 FUTURO

---

## 🎯 HITOS Y TIMELINE

```
Hoy (19 Dic 2025)
├─ Fase 1 ✅ COMPLETADO
│  └─ Arquitectura Base
│
Próxima Semana (25 Dic 2025)
├─ Fase 2 🟡 EN PROGRESO
│  ├─ Refactorizar componentes
│  └─ Testing (TDD)
│
En 1 Mes (19 Ene 2026)
├─ Fase 3 🟡 PRÓXIMO
│  ├─ Backend API
│  ├─ PostgreSQL/Supabase
│  └─ Autenticación OAuth
│
En 2 Meses (19 Feb 2026)
├─ Fase 4 🟡 PRÓXIMO
│  ├─ Workers/Queues
│  ├─ Logging
│  └─ Monitoreo
│
En 3 Meses (19 Mar 2026)
├─ Fase 5 🟡 PRÓXIMO
│  ├─ CI/CD
│  ├─ Deployment
│  └─ Docker
│
En 4-5 Meses (19 May 2026)
└─ Fase 6 🟡 PRÓXIMO
   └─ Features Avanzadas
```

---

## 📊 PRIORIZACIÓN DE TAREAS

### Priority 1 (Esta Semana)
1. [ ] Refactorizar Dashboard
2. [ ] Refactorizar WorkflowCanvas
3. [ ] Agregar tests básicos

### Priority 2 (Este Mes)
1. [ ] Backend API básico
2. [ ] PostgreSQL schema
3. [ ] Autenticación

### Priority 3 (Este Trimestre)
1. [ ] Workers
2. [ ] CI/CD
3. [ ] Deploy a producción

---

## 🛠️ STACK FINAL

### Frontend
- React 18 + TypeScript
- Zustand (State)
- Zod (Validation)
- Sonner (UI)
- Tailwind CSS

### Backend
- Node.js + Express
- PostgreSQL + Supabase
- Bull (Queues)
- Winston (Logging)

### DevOps
- Docker
- GitHub Actions
- Vercel / Railway
- Sentry

---

## 💡 TIPS PARA ÉXITO

✅ **Hacer**:
- Escribir tests mientras desarrollas
- Documentar cambios importantes
- Review de código regularmente
- Mantener commits pequeños

❌ **Evitar**:
- Feature creep
- Saltarse tests
- Deuda técnica
- Documentación desactualizada

---

## 📚 RECURSOS

- [Zustand Docs](https://github.com/pmndrs/zustand)
- [Zod Docs](https://zod.dev)
- [Express Guide](https://expressjs.com)
- [Supabase Docs](https://supabase.com/docs)
- [Testing Library](https://testing-library.com)

---

## ✅ CONCLUSIÓN

Tu sistema está en **buena forma** para escalar a producción.

**Próximo paso**: Lee QUICK_START.md y comienza con Fase 2 (refactorizar componentes).

---

**Last Updated**: 19 de Diciembre de 2025
**Version**: 1.0
**Status**: 🟢 En Desarrollo Activo
