import { pool } from "@workspace/db";

/** Database triggers cover all persisted business changes, including cascades.
 * Installation is idempotent and runs before accepting requests.
 */
export async function initializeSystemAudit() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_audit_log (
      id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      module text NOT NULL, actor_id text, actor_name text NOT NULL,
      request_id text, path text, action text NOT NULL,
      entity_type text NOT NULL, entity_id text, entity_name text, project_id text,
      old_values jsonb, new_values jsonb, changed_fields jsonb NOT NULL
    );
    ALTER TABLE system_audit_log ADD COLUMN IF NOT EXISTS project_name text;
    CREATE INDEX IF NOT EXISTS system_audit_time ON system_audit_log(occurred_at DESC);
    CREATE INDEX IF NOT EXISTS system_audit_project ON system_audit_log(project_id);
    CREATE INDEX IF NOT EXISTS system_audit_actor ON system_audit_log(actor_id);

    CREATE OR REPLACE FUNCTION system_audit_scrub(value jsonb) RETURNS jsonb
    LANGUAGE plpgsql AS $$
    DECLARE result jsonb := '{}'; k text; v jsonb;
    BEGIN
      IF value IS NULL THEN RETURN NULL; END IF;
      FOR k,v IN SELECT * FROM jsonb_each(value) LOOP
        IF k ~* '(password|secret|token|credential|session|object_path)' THEN
          result := result || jsonb_build_object(k, '[REDACTED]');
        ELSE
          result := result || jsonb_build_object(k,v);
        END IF;
      END LOOP;
      RETURN result;
    END $$;

    CREATE OR REPLACE FUNCTION capture_system_audit() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE before_row jsonb; after_row jsonb; row_data jsonb; ctx jsonb;
      fields jsonb; project text; label text; project_label text; parent_id text;
    BEGIN
      IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
      IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
      SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) INTO fields
      FROM (SELECT jsonb_object_keys(coalesce(before_row,'{}') || coalesce(after_row,'{}')) k) keys
      WHERE before_row->k IS DISTINCT FROM after_row->k AND k NOT IN ('updated_at');
      IF fields = '[]'::jsonb THEN RETURN NULL; END IF;
      ctx := coalesce(nullif(current_setting('app.audit_context',true),''),'{}')::jsonb;
      row_data := coalesce(after_row,before_row);
      project := row_data->>'project_id';
      IF TG_TABLE_NAME IN ('projects','mis_projects') THEN project := row_data->>'id'; END IF;
      IF project IS NULL AND row_data->>'daily_entry_id' IS NOT NULL THEN
        parent_id := row_data->>'daily_entry_id';
        SELECT project_id INTO project FROM daily_entries WHERE id=parent_id;
      END IF;
      IF project IS NULL AND row_data->>'project_service_id' IS NOT NULL THEN
        parent_id := row_data->>'project_service_id';
        SELECT project_id INTO project FROM project_services WHERE id=parent_id;
      END IF;
      IF project IS NULL AND parent_id IS NOT NULL THEN
        SELECT project_id INTO project FROM system_audit_log WHERE entity_id=parent_id
          ORDER BY occurred_at DESC LIMIT 1;
      END IF;
      IF TG_TABLE_NAME LIKE 'mis_%' THEN
        SELECT name INTO project_label FROM mis_projects WHERE id=project;
      ELSE
        SELECT name INTO project_label FROM projects WHERE id=project;
      END IF;
      IF TG_TABLE_NAME IN ('projects','mis_projects') THEN project_label := row_data->>'name'; END IF;
      IF project_label IS NULL AND project IS NOT NULL THEN
        SELECT project_name INTO project_label FROM system_audit_log WHERE project_id=project
          AND project_name IS NOT NULL ORDER BY occurred_at DESC LIMIT 1;
      END IF;
      label := coalesce(row_data->>'name', row_data->>'email', row_data->>'code',row_data->>'entry_date',row_data->>'id');
      INSERT INTO system_audit_log(module,actor_id,actor_name,request_id,path,action,
        entity_type,entity_id,entity_name,project_id,project_name,old_values,new_values,changed_fields)
      VALUES (
        CASE WHEN TG_TABLE_NAME LIKE 'mis_%' THEN 'MIS'
          WHEN TG_TABLE_NAME IN ('users','smtp_settings') THEN 'System' ELSE 'COGS' END,
        ctx->>'actorId',coalesce(nullif(ctx->>'actorName',''),'System / unauthenticated'),
        ctx->>'requestId',ctx->>'path',TG_OP,TG_TABLE_NAME,
        coalesce(row_data->>'id',concat_ws(':',row_data->>'project_id',row_data->>'tab_id',row_data->>'user_id')),
        label,project,project_label,system_audit_scrub(before_row),system_audit_scrub(after_row),fields
      );
      RETURN NULL;
    END $$;

    CREATE OR REPLACE FUNCTION protect_system_audit() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'System audit history is append-only'; END $$;
    DROP TRIGGER IF EXISTS system_audit_immutable ON system_audit_log;
    CREATE TRIGGER system_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON system_audit_log
      FOR EACH STATEMENT EXECUTE FUNCTION protect_system_audit();

    DO $$ DECLARE t record; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
        AND tablename NOT IN ('system_audit_log','entry_audit_log','mis_audit_log',
          'sessions','password_reset_tokens','__drizzle_migrations')
        AND (tablename IN ('users','smtp_settings','projects','project_services','service_sub_items',
          'food_meal_items','security_groups','project_access','security_group_members',
          'daily_entries','service_cost_entries','meal_cost_entries','sub_service_cost_entries',
          'entry_approvals','project_approver_assignments','project_approval_chain','entry_attachments')
          OR tablename LIKE 'mis_%')
      LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS system_audit_capture ON %I',t.tablename);
        EXECUTE format('CREATE TRIGGER system_audit_capture AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION capture_system_audit()',t.tablename);
      END LOOP;
    END $$;
  `);
}
