--
-- PostgreSQL database dump
--

-- \restrict f7hcJH18CECxRwQgYBYPMpIvYnEQk08ZVrEJNuRc58FjhS6tSSUgNbV1mf2OdZF

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";

--
-- Name: marcar_clave_cambiada(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."marcar_clave_cambiada"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
                UPDATE public.profiles
                   SET debe_cambiar_clave = false
                 WHERE id = auth.uid();
            $$;


ALTER FUNCTION "public"."marcar_clave_cambiada"() OWNER TO "postgres";

--
-- Name: FUNCTION "marcar_clave_cambiada"(); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."marcar_clave_cambiada"() IS 'Limpia debe_cambiar_clave del usuario autenticado tras cambiar su contrasena. SECURITY DEFINER porque profiles solo lo escribe un admin.';


--
-- Name: my_organization_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."my_organization_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;


ALTER FUNCTION "public"."my_organization_id"() OWNER TO "postgres";

--
-- Name: my_role(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."my_role"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid()
$$;


ALTER FUNCTION "public"."my_role"() OWNER TO "postgres";

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "usuario_id" "uuid",
    "usuario_email" "text",
    "accion" "text" NOT NULL,
    "entidad" "text" NOT NULL,
    "entidad_id" "uuid",
    "descripcion" "text",
    "datos_antes" "jsonb",
    "datos_despues" "jsonb",
    "ip_address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_log_accion_check" CHECK (("accion" = ANY (ARRAY['crear'::"text", 'modificar'::"text", 'eliminar'::"text", 'ejecutar'::"text", 'aprobar'::"text", 'rechazar'::"text", 'login'::"text", 'cambio_rol'::"text", 'escalamiento'::"text", 'vencimiento'::"text"]))),
    CONSTRAINT "audit_log_entidad_check" CHECK (("entidad" = ANY (ARRAY['workflow'::"text", 'usuario'::"text", 'integracion'::"text", 'aprobacion'::"text", 'sesion'::"text"])))
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";

--
-- Name: delegaciones; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."delegaciones" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "usuario_id" "uuid" NOT NULL,
    "suplente_id" "uuid" NOT NULL,
    "desde" timestamp with time zone NOT NULL,
    "hasta" timestamp with time zone NOT NULL,
    "motivo" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."delegaciones" OWNER TO "postgres";

--
-- Name: execution_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."execution_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "node_id" "uuid",
    "status" "text" NOT NULL,
    "message" "text" NOT NULL,
    "details_json" "jsonb",
    "duration_ms" integer,
    "executed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "execution_run_id" "uuid",
    CONSTRAINT "execution_logs_status_check" CHECK (("status" = ANY (ARRAY['success'::"text", 'error'::"text", 'warning'::"text", 'info'::"text"])))
);


ALTER TABLE "public"."execution_logs" OWNER TO "postgres";

--
-- Name: execution_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."execution_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "triggered_by" "text" DEFAULT 'manual'::"text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "finished_at" timestamp with time zone,
    "duration_ms" integer,
    "error_message" "text",
    "logs_count" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "context_json" "jsonb",
    "completed_node_ids" "text"[] DEFAULT '{}'::"text"[],
    "paused_node_id" "text",
    "definicion_huella" "text"
);


ALTER TABLE "public"."execution_runs" OWNER TO "postgres";

--
-- Name: COLUMN "execution_runs"."definicion_huella"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."execution_runs"."definicion_huella" IS 'SHA-256 de la definición (nodos+conexiones, sin posiciones) en el momento de pausar por aprobación. Al reanudar se recalcula: si no coincide, el flujo cambió después de aprobarse y no se reanuda.';


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "system_name" "text" NOT NULL,
    "config_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "integrations_system_name_check" CHECK (("system_name" = ANY (ARRAY['riskguard'::"text", 'eeff'::"text", 'indicadores'::"text", 'legaltech'::"text"])))
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";

--
-- Name: matriz_aprobacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."matriz_aprobacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "nombre" "text" NOT NULL,
    "categoria" "text",
    "umbral_monto" numeric DEFAULT 0,
    "moneda" "text" DEFAULT 'USD'::"text",
    "rol_aprobador" "text" NOT NULL,
    "nivel" integer DEFAULT 1 NOT NULL,
    "activa" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "operador" "text" DEFAULT '>='::"text" NOT NULL,
    "umbral_max" numeric,
    "condicion_extra" "text",
    "aprobadores_multiples" integer DEFAULT 1 NOT NULL,
    "escalamiento_horas" integer DEFAULT 48 NOT NULL,
    "aplica_automatico" boolean DEFAULT false NOT NULL,
    "descripcion_regulatoria" "text",
    "veces_activada" integer DEFAULT 0 NOT NULL,
    "aprobaciones_count" integer DEFAULT 0 NOT NULL,
    "rechazos_count" integer DEFAULT 0 NOT NULL,
    "tiempo_promedio_hs" numeric,
    CONSTRAINT "matriz_aprobacion_aprobadores_multiples_check" CHECK ((("aprobadores_multiples" >= 1) AND ("aprobadores_multiples" <= 5))),
    CONSTRAINT "matriz_aprobacion_operador_check" CHECK (("operador" = ANY (ARRAY['>='::"text", '>'::"text", '<='::"text", '<'::"text", '=='::"text", 'entre'::"text"])))
);


ALTER TABLE "public"."matriz_aprobacion" OWNER TO "postgres";

--
-- Name: COLUMN "matriz_aprobacion"."operador"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."operador" IS '>= | > | <= | < | == | entre (rango umbral_monto..umbral_max)';


--
-- Name: COLUMN "matriz_aprobacion"."aprobadores_multiples"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."aprobadores_multiples" IS 'Cuántos aprobadores distintos deben autorizar (doble control = 2)';


--
-- Name: COLUMN "matriz_aprobacion"."aplica_automatico"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."aplica_automatico" IS 'Si true, el Agente IA puede decidir sin aprobador humano';


--
-- Name: COLUMN "matriz_aprobacion"."descripcion_regulatoria"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."matriz_aprobacion"."descripcion_regulatoria" IS 'Referencia normativa: SUDEBAN Circular 7, OFAC 50% Rule, etc.';


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notif_email" "text",
    "notif_errors" boolean DEFAULT true NOT NULL,
    "notif_success" boolean DEFAULT false NOT NULL,
    "kpi_sla_ms" integer DEFAULT 30000 NOT NULL,
    "kpi_min_por_tarea" integer DEFAULT 15 NOT NULL,
    "kpi_costo_hora_usd" integer DEFAULT 25 NOT NULL,
    CONSTRAINT "organizations_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'pro'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";

--
-- Name: COLUMN "organizations"."kpi_sla_ms"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."organizations"."kpi_sla_ms" IS 'Umbral SLA en milisegundos (default 30s)';


--
-- Name: COLUMN "organizations"."kpi_min_por_tarea"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."organizations"."kpi_min_por_tarea" IS 'Minutos ahorrados por tarea exitosa (default 15)';


--
-- Name: COLUMN "organizations"."kpi_costo_hora_usd"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."organizations"."kpi_costo_hora_usd" IS 'Costo hora-hombre en USD para calcular ahorro (default 25)';


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" DEFAULT 'viewer'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "debe_cambiar_clave" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'supervisor'::"text", 'operador'::"text", 'autorizador'::"text", 'cumplimiento'::"text", 'auditor'::"text", 'editor'::"text", 'operator'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";

--
-- Name: COLUMN "profiles"."debe_cambiar_clave"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."profiles"."debe_cambiar_clave" IS 'true cuando la clave vigente la asigno un administrador (olvido). La pantalla obliga a cambiarla antes de dejar entrar. Lo pone admin-reset-password; lo quita marcar_clave_cambiada().';


--
-- Name: tareas_aprobacion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."tareas_aprobacion" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "execution_run_id" "uuid" NOT NULL,
    "node_id" "text" NOT NULL,
    "node_title" "text",
    "solicitante_id" "uuid",
    "rol_aprobador" "text" NOT NULL,
    "aprobador_id" "uuid",
    "monto" numeric,
    "categoria" "text",
    "descripcion" "text",
    "estado" "text" DEFAULT 'pendiente'::"text" NOT NULL,
    "comentario" "text",
    "vence_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    "nivel_escalamiento" integer DEFAULT 0 NOT NULL,
    "escalado_at" timestamp with time zone,
    "rol_aprobador_original" "text",
    CONSTRAINT "tareas_aprobacion_estado_check" CHECK (("estado" = ANY (ARRAY['pendiente'::"text", 'aprobado'::"text", 'rechazado'::"text", 'devuelto'::"text", 'expirado'::"text"])))
);


ALTER TABLE "public"."tareas_aprobacion" OWNER TO "postgres";

--
-- Name: workflow_connections; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."workflow_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "source_node_id" "uuid" NOT NULL,
    "target_node_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "branch" "text",
    CONSTRAINT "workflow_connections_branch_check" CHECK (("branch" = ANY (ARRAY['true'::"text", 'false'::"text"])))
);


ALTER TABLE "public"."workflow_connections" OWNER TO "postgres";

--
-- Name: workflow_nodes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."workflow_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "title" "text" NOT NULL,
    "position_x" integer DEFAULT 0 NOT NULL,
    "position_y" integer DEFAULT 0 NOT NULL,
    "config_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflow_nodes_status_check" CHECK (("status" = ANY (ARRAY['idle'::"text", 'running'::"text", 'success'::"text", 'error'::"text"]))),
    CONSTRAINT "workflow_nodes_type_check" CHECK (("type" = ANY (ARRAY['trigger'::"text", 'connector'::"text", 'processor'::"text", 'output'::"text"])))
);


ALTER TABLE "public"."workflow_nodes" OWNER TO "postgres";

--
-- Name: workflows; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT false NOT NULL,
    "schedule_type" "text",
    "schedule_value" "text",
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_run_at" timestamp with time zone,
    "execution_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "workflows_schedule_type_check" CHECK (("schedule_type" = ANY (ARRAY['manual'::"text", 'cron'::"text", 'webhook'::"text", 'event'::"text"]))),
    CONSTRAINT "workflows_status_check" CHECK (("status" = ANY (ARRAY['idle'::"text", 'running'::"text", 'error'::"text", 'paused'::"text"])))
);


ALTER TABLE "public"."workflows" OWNER TO "postgres";

--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");


--
-- Name: delegaciones delegaciones_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_pkey" PRIMARY KEY ("id");


--
-- Name: execution_logs execution_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_pkey" PRIMARY KEY ("id");


--
-- Name: execution_runs execution_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_pkey" PRIMARY KEY ("id");


--
-- Name: integrations integrations_organization_id_system_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_organization_id_system_name_key" UNIQUE ("organization_id", "system_name");


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");


--
-- Name: matriz_aprobacion matriz_aprobacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matriz_aprobacion"
    ADD CONSTRAINT "matriz_aprobacion_pkey" PRIMARY KEY ("id");


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: tareas_aprobacion tareas_aprobacion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."tareas_aprobacion"
    ADD CONSTRAINT "tareas_aprobacion_pkey" PRIMARY KEY ("id");


--
-- Name: workflow_connections workflow_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_pkey" PRIMARY KEY ("id");


--
-- Name: workflow_connections workflow_connections_source_node_id_target_node_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_source_node_id_target_node_id_key" UNIQUE ("source_node_id", "target_node_id");


--
-- Name: workflow_nodes workflow_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_nodes"
    ADD CONSTRAINT "workflow_nodes_pkey" PRIMARY KEY ("id");


--
-- Name: workflows workflows_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");


--
-- Name: idx_audit_entidad; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_entidad" ON "public"."audit_log" USING "btree" ("entidad", "entidad_id");


--
-- Name: idx_audit_org_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_org_date" ON "public"."audit_log" USING "btree" ("organization_id", "created_at" DESC);


--
-- Name: idx_execution_logs_org_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_logs_org_date" ON "public"."execution_logs" USING "btree" ("organization_id", "executed_at" DESC);


--
-- Name: idx_execution_logs_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_logs_run" ON "public"."execution_logs" USING "btree" ("execution_run_id");


--
-- Name: idx_execution_logs_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_logs_workflow" ON "public"."execution_logs" USING "btree" ("workflow_id");


--
-- Name: idx_execution_runs_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_runs_org" ON "public"."execution_runs" USING "btree" ("organization_id", "started_at" DESC);


--
-- Name: idx_execution_runs_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_execution_runs_workflow" ON "public"."execution_runs" USING "btree" ("workflow_id");


--
-- Name: idx_matriz_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_matriz_org" ON "public"."matriz_aprobacion" USING "btree" ("organization_id", "nivel");


--
-- Name: idx_tareas_aprobacion_estado; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_tareas_aprobacion_estado" ON "public"."tareas_aprobacion" USING "btree" ("organization_id", "estado");


--
-- Name: idx_tareas_aprobacion_rol; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_tareas_aprobacion_rol" ON "public"."tareas_aprobacion" USING "btree" ("organization_id", "rol_aprobador", "estado");


--
-- Name: idx_tareas_aprobacion_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_tareas_aprobacion_run" ON "public"."tareas_aprobacion" USING "btree" ("execution_run_id");


--
-- Name: idx_workflow_nodes_workflow; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_workflow_nodes_workflow" ON "public"."workflow_nodes" USING "btree" ("workflow_id");


--
-- Name: idx_workflows_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_workflows_org" ON "public"."workflows" USING "btree" ("organization_id");


--
-- Name: integrations trg_integrations_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_integrations_updated" BEFORE UPDATE ON "public"."integrations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: workflows trg_workflows_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_workflows_updated" BEFORE UPDATE ON "public"."workflows" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: audit_log audit_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: audit_log audit_log_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."profiles"("id");


--
-- Name: delegaciones delegaciones_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: delegaciones delegaciones_suplente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_suplente_id_fkey" FOREIGN KEY ("suplente_id") REFERENCES "public"."profiles"("id");


--
-- Name: delegaciones delegaciones_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."delegaciones"
    ADD CONSTRAINT "delegaciones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."profiles"("id");


--
-- Name: execution_logs execution_logs_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_execution_run_id_fkey" FOREIGN KEY ("execution_run_id") REFERENCES "public"."execution_runs"("id") ON DELETE CASCADE;


--
-- Name: execution_logs execution_logs_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE SET NULL;


--
-- Name: execution_logs execution_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: execution_logs execution_logs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_logs"
    ADD CONSTRAINT "execution_logs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: execution_runs execution_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: execution_runs execution_runs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: execution_runs execution_runs_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."execution_runs"
    ADD CONSTRAINT "execution_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: integrations integrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: matriz_aprobacion matriz_aprobacion_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matriz_aprobacion"
    ADD CONSTRAINT "matriz_aprobacion_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: matriz_aprobacion matriz_aprobacion_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."matriz_aprobacion"
    ADD CONSTRAINT "matriz_aprobacion_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: profiles profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: tareas_aprobacion tareas_aprobacion_execution_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."tareas_aprobacion"
    ADD CONSTRAINT "tareas_aprobacion_execution_run_id_fkey" FOREIGN KEY ("execution_run_id") REFERENCES "public"."execution_runs"("id") ON DELETE CASCADE;


--
-- Name: tareas_aprobacion tareas_aprobacion_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."tareas_aprobacion"
    ADD CONSTRAINT "tareas_aprobacion_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: workflow_connections workflow_connections_source_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_source_node_id_fkey" FOREIGN KEY ("source_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE CASCADE;


--
-- Name: workflow_connections workflow_connections_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_target_node_id_fkey" FOREIGN KEY ("target_node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE CASCADE;


--
-- Name: workflow_connections workflow_connections_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_connections"
    ADD CONSTRAINT "workflow_connections_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: workflow_nodes workflow_nodes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_nodes"
    ADD CONSTRAINT "workflow_nodes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: workflow_nodes workflow_nodes_workflow_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflow_nodes"
    ADD CONSTRAINT "workflow_nodes_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;


--
-- Name: workflows workflows_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: workflows workflows_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;


--
-- Name: audit_log audit_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "audit_insert" ON "public"."audit_log" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: audit_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_log audit_read_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "audit_read_org" ON "public"."audit_log" FOR SELECT TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'cumplimiento'::"text", 'auditor'::"text"]))));


--
-- Name: workflow_connections connections_editor_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "connections_editor_write" ON "public"."workflow_connections" TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."workflows" "w"
  WHERE (("w"."id" = "workflow_connections"."workflow_id") AND ("w"."organization_id" = "public"."my_organization_id"())))) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"])))) WITH CHECK (((EXISTS ( SELECT 1
   FROM "public"."workflows" "w"
  WHERE (("w"."id" = "workflow_connections"."workflow_id") AND ("w"."organization_id" = "public"."my_organization_id"())))) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflow_connections connections_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "connections_tenant_read" ON "public"."workflow_connections" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."workflows" "w"
  WHERE (("w"."id" = "workflow_connections"."workflow_id") AND ("w"."organization_id" = "public"."my_organization_id"())))));


--
-- Name: delegaciones deleg_read_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "deleg_read_org" ON "public"."delegaciones" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: delegaciones deleg_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "deleg_write" ON "public"."delegaciones" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."is_admin"() OR ("usuario_id" = "auth"."uid"())))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."is_admin"() OR ("usuario_id" = "auth"."uid"()))));


--
-- Name: delegaciones; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."delegaciones" ENABLE ROW LEVEL SECURITY;

--
-- Name: execution_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."execution_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: execution_runs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."execution_runs" ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations integrations_admin_manage; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "integrations_admin_manage" ON "public"."integrations" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text"))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text")));


--
-- Name: integrations integrations_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "integrations_tenant_read" ON "public"."integrations" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_logs logs_system_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "logs_system_insert" ON "public"."execution_logs" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_logs logs_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "logs_tenant_read" ON "public"."execution_logs" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: matriz_aprobacion matriz_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "matriz_admin_write" ON "public"."matriz_aprobacion" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"())) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"()));


--
-- Name: matriz_aprobacion; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."matriz_aprobacion" ENABLE ROW LEVEL SECURITY;

--
-- Name: matriz_aprobacion matriz_read_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "matriz_read_org" ON "public"."matriz_aprobacion" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: workflow_nodes nodes_editor_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nodes_editor_write" ON "public"."workflow_nodes" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"])))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflow_nodes nodes_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "nodes_tenant_read" ON "public"."workflow_nodes" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: organizations org_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "org_admin_update" ON "public"."organizations" FOR UPDATE TO "authenticated" USING ((("id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text"))) WITH CHECK ((("id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text")));


--
-- Name: tareas_aprobacion org_isolation; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "org_isolation" ON "public"."tareas_aprobacion" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: organizations org_read_own; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "org_read_own" ON "public"."organizations" FOR SELECT TO "authenticated" USING (("id" = "public"."my_organization_id"()));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_admin_manage; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles_admin_manage" ON "public"."profiles" TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"())) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND "public"."is_admin"()));


--
-- Name: profiles profiles_read_own_org; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles_read_own_org" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_runs runs_system_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "runs_system_insert" ON "public"."execution_runs" FOR INSERT TO "authenticated" WITH CHECK (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_runs runs_system_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "runs_system_update" ON "public"."execution_runs" FOR UPDATE TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: execution_runs runs_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "runs_tenant_read" ON "public"."execution_runs" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: tareas_aprobacion; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."tareas_aprobacion" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_connections; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."workflow_connections" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflow_nodes; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."workflow_nodes" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflows; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;

--
-- Name: workflows workflows_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_admin_delete" ON "public"."workflows" FOR DELETE TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = 'admin'::"text")));


--
-- Name: workflows workflows_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_editor_update" ON "public"."workflows" FOR UPDATE TO "authenticated" USING ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"])))) WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflows workflows_editor_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_editor_write" ON "public"."workflows" FOR INSERT TO "authenticated" WITH CHECK ((("organization_id" = "public"."my_organization_id"()) AND ("public"."my_role"() = ANY (ARRAY['admin'::"text", 'dueno_proceso'::"text", 'editor'::"text"]))));


--
-- Name: workflows workflows_tenant_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "workflows_tenant_read" ON "public"."workflows" FOR SELECT TO "authenticated" USING (("organization_id" = "public"."my_organization_id"()));


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "is_admin"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";


--
-- Name: FUNCTION "marcar_clave_cambiada"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."marcar_clave_cambiada"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_clave_cambiada"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_clave_cambiada"() TO "service_role";


--
-- Name: FUNCTION "my_organization_id"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_organization_id"() TO "service_role";


--
-- Name: FUNCTION "my_role"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_role"() TO "service_role";


--
-- Name: FUNCTION "set_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


--
-- Name: TABLE "audit_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";


--
-- Name: TABLE "delegaciones"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."delegaciones" TO "anon";
GRANT ALL ON TABLE "public"."delegaciones" TO "authenticated";
GRANT ALL ON TABLE "public"."delegaciones" TO "service_role";


--
-- Name: TABLE "execution_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."execution_logs" TO "anon";
GRANT ALL ON TABLE "public"."execution_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."execution_logs" TO "service_role";


--
-- Name: TABLE "execution_runs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."execution_runs" TO "anon";
GRANT ALL ON TABLE "public"."execution_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."execution_runs" TO "service_role";


--
-- Name: TABLE "integrations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";


--
-- Name: TABLE "matriz_aprobacion"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."matriz_aprobacion" TO "anon";
GRANT ALL ON TABLE "public"."matriz_aprobacion" TO "authenticated";
GRANT ALL ON TABLE "public"."matriz_aprobacion" TO "service_role";


--
-- Name: TABLE "organizations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "tareas_aprobacion"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."tareas_aprobacion" TO "anon";
GRANT ALL ON TABLE "public"."tareas_aprobacion" TO "authenticated";
GRANT ALL ON TABLE "public"."tareas_aprobacion" TO "service_role";


--
-- Name: TABLE "workflow_connections"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."workflow_connections" TO "anon";
GRANT ALL ON TABLE "public"."workflow_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_connections" TO "service_role";


--
-- Name: TABLE "workflow_nodes"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."workflow_nodes" TO "anon";
GRANT ALL ON TABLE "public"."workflow_nodes" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_nodes" TO "service_role";


--
-- Name: TABLE "workflows"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."workflows" TO "anon";
GRANT ALL ON TABLE "public"."workflows" TO "authenticated";
GRANT ALL ON TABLE "public"."workflows" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- PostgreSQL database dump complete
--

-- \unrestrict f7hcJH18CECxRwQgYBYPMpIvYnEQk08ZVrEJNuRc58FjhS6tSSUgNbV1mf2OdZF

