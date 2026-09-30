-- ============================================================
-- 20260930150000_audit_triggers.sql — Auditoría automática desde la base de datos
--
-- Antes: el registro dependía de que cada pantalla llamara log_action, que
-- aceptaba CUALQUIER negocio y CUALQUIER nombre de actor (se podía falsificar)
-- y dejaba por fuera anulaciones, descuentos, precios, caja, gastos, etc.
--
-- Ahora:
--   - Triggers en las tablas sensibles escriben el registro solos, con una
--     frase en español (summary), categoría, severidad y monto.
--   - El actor sale de la sesión real (auth.uid() → profiles.full_name); sin
--     sesión = "Cliente (en línea)" o "Sistema".
--   - Un fallo de auditoría NUNCA bloquea la operación (se avisa y sigue).
--   - Los usuarios no escriben audit_logs; solo el admin los lee.
--   - log_action queda para eventos puntuales de la app, con negocio verificado
--     y actor tomado de la sesión (se ignoran los parámetros de actor).
-- ============================================================

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IS NULL OR category IN
    ('money', 'cash', 'inventory', 'appointments', 'team', 'settings', 'customers')),
  ADD COLUMN IF NOT EXISTS summary  TEXT,
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning')),
  ADD COLUMN IF NOT EXISTS amount   INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_logs_business_category ON public.audit_logs (business_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_business_actor    ON public.audit_logs (business_id, actor_id, created_at DESC);

-- ── Núcleo ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._audit_actor()
RETURNS TABLE (actor_id UUID, actor_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid(),
         CASE
           WHEN auth.uid() IS NOT NULL THEN
             COALESCE((SELECT NULLIF(btrim(full_name), '') FROM profiles WHERE id = auth.uid()), 'Usuario')
           WHEN COALESCE(auth.role(), '') = 'anon' THEN 'Cliente (en línea)'
           ELSE 'Sistema'
         END
$$;

CREATE OR REPLACE FUNCTION public._audit(
  p_business_id UUID,
  p_category    TEXT,
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_summary     TEXT,
  p_severity    TEXT    DEFAULT 'info',
  p_amount      NUMERIC DEFAULT NULL,
  p_old         JSONB   DEFAULT NULL,
  p_new         JSONB   DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD;
BEGIN
  SELECT * INTO a FROM public._audit_actor();
  INSERT INTO audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id,
                          old_value, new_value, category, summary, severity, amount)
  VALUES (p_business_id, a.actor_id, a.actor_name, p_action, p_entity_type, p_entity_id,
          p_old, p_new, p_category, LEFT(p_summary, 500), COALESCE(p_severity, 'info'), ROUND(p_amount)::INTEGER);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit: % (%)', SQLERRM, p_action;
END;
$$;
REVOKE ALL ON FUNCTION public._audit_actor() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._audit(UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, NUMERIC, JSONB, JSONB) FROM PUBLIC, anon, authenticated;

-- Pesos legibles; NULL si no hay monto (acepta enteros o decimales)
CREATE OR REPLACE FUNCTION public._m(p NUMERIC) RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE WHEN p IS NULL THEN NULL ELSE public._money_cop(p) END
$$;
REVOKE ALL ON FUNCTION public._m(NUMERIC) FROM PUBLIC, anon, authenticated;

-- ── Ventas: descuentos y anulaciones ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_sales()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client TEXT;
BEGIN
  SELECT full_name INTO v_client FROM customers WHERE id = NEW.customer_id;
  IF TG_OP = 'INSERT' AND COALESCE(NEW.discount_amount, 0) > 0 THEN
    PERFORM public._audit(NEW.business_id, 'money', 'sale.discount', 'sale', NEW.id,
      'aplicó un descuento de ' || public._m(NEW.discount_amount::INTEGER) || ' en una venta de '
        || public._m(NEW.subtotal::INTEGER) || COALESCE(' a ' || v_client, ''),
      CASE WHEN NEW.subtotal > 0 AND NEW.discount_amount >= NEW.subtotal * 0.2 THEN 'warning' ELSE 'info' END,
      NEW.discount_amount::INTEGER, NULL,
      jsonb_build_object('subtotal', NEW.subtotal, 'descuento', NEW.discount_amount, 'total', NEW.total_amount));
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'voided' AND OLD.status IS DISTINCT FROM 'voided' THEN
    PERFORM public._audit(NEW.business_id, 'money', 'sale.voided', 'sale', NEW.id,
      'anuló una venta de ' || public._m(NEW.total_amount::INTEGER) || COALESCE(' a ' || v_client, '')
        || COALESCE(' · motivo: ' || NEW.void_reason, ''),
      'warning', NEW.total_amount::INTEGER,
      jsonb_build_object('estado', OLD.status), jsonb_build_object('estado', NEW.status, 'motivo', NEW.void_reason));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Cuenta del equipo: pagos, anticipos, bonos, descuentos manuales ──────────
CREATE OR REPLACE FUNCTION public._trg_audit_staff_ledger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff TEXT; v_label TEXT; v_method TEXT;
BEGIN
  IF NEW.entry_type NOT IN ('advance', 'payment', 'bonus', 'deduction') THEN RETURN NEW; END IF;
  IF NEW.entry_type = 'deduction' AND COALESCE(NEW.notes, '') LIKE 'Anulación de venta%' THEN RETURN NEW; END IF;
  SELECT full_name INTO v_staff FROM staff WHERE id = NEW.staff_id;
  v_label := CASE NEW.entry_type
               WHEN 'advance' THEN 'un anticipo' WHEN 'payment' THEN 'un pago'
               WHEN 'bonus' THEN 'un bono' ELSE 'un descuento' END;
  v_method := CASE NEW.payment_method
                WHEN 'cash_register' THEN ' (efectivo de la caja)' WHEN 'transfer' THEN ' (transferencia)'
                WHEN 'other' THEN ' (otro medio)' ELSE '' END;
  PERFORM public._audit(NEW.business_id, 'money', 'ledger.' || NEW.entry_type, 'staff_ledger', NEW.id,
    'registró ' || v_label || ' de ' || public._m(NEW.amount) || ' a ' || COALESCE(v_staff, 'un profesional')
      || v_method || COALESCE(' · ' || NULLIF(NEW.notes, ''), ''),
    CASE WHEN NEW.entry_type IN ('advance', 'deduction', 'bonus') THEN 'warning' ELSE 'info' END,
    NEW.amount, NULL, jsonb_build_object('tipo', NEW.entry_type, 'monto', NEW.amount, 'nota', NEW.notes));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Gastos ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_expenses()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'money', 'expense.created', 'expense', NEW.id,
      CASE WHEN NEW.auto_registered THEN 'registró automáticamente el gasto fijo "' ELSE 'registró el gasto "' END
        || NEW.description || '" por ' || public._m(NEW.amount)
        || CASE WHEN NEW.payment_method = 'cash_register' THEN ' (efectivo de la caja)' ELSE '' END,
      'info', NEW.amount, NULL, to_jsonb(NEW) - 'business_id');
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.description IS DISTINCT FROM OLD.description
       OR NEW.expense_date IS DISTINCT FROM OLD.expense_date OR NEW.category IS DISTINCT FROM OLD.category
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      PERFORM public._audit(NEW.business_id, 'money', 'expense.updated', 'expense', NEW.id,
        'editó el gasto "' || NEW.description || '"'
          || CASE WHEN NEW.amount IS DISTINCT FROM OLD.amount
                  THEN ': ' || public._m(OLD.amount) || ' → ' || public._m(NEW.amount) ELSE '' END,
        CASE WHEN NEW.amount IS DISTINCT FROM OLD.amount THEN 'warning' ELSE 'info' END,
        NEW.amount,
        jsonb_build_object('descripcion', OLD.description, 'monto', OLD.amount, 'fecha', OLD.expense_date, 'categoria', OLD.category),
        jsonb_build_object('descripcion', NEW.description, 'monto', NEW.amount, 'fecha', NEW.expense_date, 'categoria', NEW.category));
    END IF;
  ELSE
    PERFORM public._audit(OLD.business_id, 'money', 'expense.deleted', 'expense', OLD.id,
      'eliminó el gasto "' || OLD.description || '" por ' || public._m(OLD.amount),
      'warning', OLD.amount, to_jsonb(OLD) - 'business_id', NULL);
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Reglas de comisión ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._commission_rule_text(r public.commission_rules)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT full_name FROM staff WHERE id = r.staff_id), 'todo el equipo')
      || ' · ' || COALESCE((SELECT name FROM services WHERE id = r.service_id), 'todos los servicios')
      || ': ' || CASE WHEN r.commission_percentage > 0 THEN r.commission_percentage || '%'
                      WHEN r.fixed_amount > 0 THEN public._m(r.fixed_amount) || ' fijo'
                      ELSE 'sin comisión de servicio' END
      || CASE WHEN COALESCE(r.product_percentage, 0) > 0 THEN ', productos ' || r.product_percentage || '%' ELSE '' END
$$;

CREATE OR REPLACE FUNCTION public._trg_audit_commission_rules()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'money', 'commission_rule.created', 'commission_rule', NEW.id,
      'creó la regla de comisión ' || public._commission_rule_text(NEW), 'warning', NULL, NULL, to_jsonb(NEW));
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public._audit(NEW.business_id, 'money', 'commission_rule.updated', 'commission_rule', NEW.id,
      'cambió la regla de comisión: ' || public._commission_rule_text(OLD) || ' → ' || public._commission_rule_text(NEW),
      'warning', NULL, to_jsonb(OLD), to_jsonb(NEW));
  ELSE
    PERFORM public._audit(OLD.business_id, 'money', 'commission_rule.deleted', 'commission_rule', OLD.id,
      'eliminó la regla de comisión ' || public._commission_rule_text(OLD), 'warning', NULL, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Servicios: precio, duración, activo ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_services()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'settings', 'service.created', 'service', NEW.id,
      'creó el servicio "' || NEW.name || '" a ' || public._m(NEW.price_cop), 'info', NEW.price_cop, NULL,
      jsonb_build_object('nombre', NEW.name, 'precio', NEW.price_cop, 'duracion', NEW.duration_minutes));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.price_cop IS DISTINCT FROM OLD.price_cop THEN
      PERFORM public._audit(NEW.business_id, 'settings', 'service.price_changed', 'service', NEW.id,
        'cambió el precio de "' || NEW.name || '": ' || public._m(OLD.price_cop) || ' → ' || public._m(NEW.price_cop),
        'warning', NEW.price_cop, jsonb_build_object('precio', OLD.price_cop), jsonb_build_object('precio', NEW.price_cop));
    END IF;
    IF NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes THEN
      PERFORM public._audit(NEW.business_id, 'settings', 'service.duration_changed', 'service', NEW.id,
        'cambió la duración de "' || NEW.name || '": ' || OLD.duration_minutes || ' → ' || NEW.duration_minutes || ' min',
        'info', NULL, jsonb_build_object('duracion', OLD.duration_minutes), jsonb_build_object('duracion', NEW.duration_minutes));
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      PERFORM public._audit(NEW.business_id, 'settings', 'service.status_changed', 'service', NEW.id,
        CASE WHEN NEW.is_active THEN 'activó' ELSE 'desactivó' END || ' el servicio "' || NEW.name || '"',
        'info', NULL, NULL, NULL);
    END IF;
  ELSE
    PERFORM public._audit(OLD.business_id, 'settings', 'service.deleted', 'service', OLD.id,
      'eliminó el servicio "' || OLD.name || '"', 'warning', NULL, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Productos: precio de venta, activo ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_inventory_items()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'inventory', 'product.created', 'inventory_item', NEW.id,
      'creó el producto "' || NEW.name || '"' || COALESCE(' a ' || public._m(NEW.unit_price::INTEGER), ''),
      'info', NEW.unit_price::INTEGER, NULL, NULL);
  ELSE
    IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
      PERFORM public._audit(NEW.business_id, 'inventory', 'product.price_changed', 'inventory_item', NEW.id,
        'cambió el precio de "' || NEW.name || '": ' || COALESCE(public._m(OLD.unit_price::INTEGER), 'sin precio')
          || ' → ' || COALESCE(public._m(NEW.unit_price::INTEGER), 'sin precio'),
        'warning', NEW.unit_price::INTEGER,
        jsonb_build_object('precio', OLD.unit_price), jsonb_build_object('precio', NEW.unit_price));
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      PERFORM public._audit(NEW.business_id, 'inventory', 'product.status_changed', 'inventory_item', NEW.id,
        CASE WHEN NEW.is_active THEN 'activó' ELSE 'desactivó' END || ' el producto "' || NEW.name || '"',
        'info', NULL, NULL, NULL);
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Movimientos manuales de inventario ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_inventory_movements()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_item TEXT;
BEGIN
  IF NEW.movement_type = 'sale' THEN RETURN NEW; END IF;
  SELECT name INTO v_item FROM inventory_items WHERE id = NEW.item_id;
  PERFORM public._audit(NEW.business_id, 'inventory', 'inventory.' || NEW.movement_type, 'inventory_item', NEW.item_id,
    CASE NEW.movement_type
      WHEN 'purchase'   THEN 'registró una compra de ' || NEW.quantity || ' ' || COALESCE(v_item, 'producto')
                             || COALESCE(' por ' || public._m(NEW.total_cost), '')
                             || CASE WHEN NEW.payment_method = 'cash_register' THEN ' (efectivo de la caja)' ELSE '' END
      WHEN 'waste'      THEN 'registró una merma de ' || ABS(NEW.quantity) || ' ' || COALESCE(v_item, 'producto')
      ELSE 'ajustó el inventario de ' || COALESCE(v_item, 'un producto') || ' en '
             || CASE WHEN NEW.quantity > 0 THEN '+' ELSE '' END || NEW.quantity
    END || COALESCE(' · ' || NULLIF(NEW.notes, ''), ''),
    CASE WHEN NEW.movement_type IN ('waste', 'adjustment') THEN 'warning' ELSE 'info' END,
    NEW.total_cost, NULL,
    jsonb_build_object('tipo', NEW.movement_type, 'cantidad', NEW.quantity, 'costo_total', NEW.total_cost, 'nota', NEW.notes));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Ajustes manuales de puntos/sellos ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_loyalty()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client TEXT; v_delta INTEGER;
BEGIN
  IF NEW.entry_type <> 'adjust' OR COALESCE(NEW.notes, '') LIKE '%anulación%' THEN RETURN NEW; END IF;
  SELECT full_name INTO v_client FROM customers WHERE id = NEW.client_id;
  v_delta := COALESCE(NEW.points_added, 0) - COALESCE(NEW.points_redeemed, 0);
  PERFORM public._audit(NEW.business_id, 'customers', 'loyalty.adjusted', 'customer', NEW.client_id,
    'ajustó ' || CASE WHEN v_delta > 0 THEN '+' ELSE '' END || v_delta
      || CASE WHEN NEW.kind = 'stamps' THEN ' sellos' ELSE ' puntos' END
      || ' a ' || COALESCE(v_client, 'un cliente') || COALESCE(' · ' || NULLIF(NEW.notes, ''), ''),
    'warning', NULL, NULL, jsonb_build_object('cambio', v_delta, 'tipo', NEW.kind, 'motivo', NEW.notes));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Caja: apertura y cierre con diferencia ───────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_shifts()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_expected INTEGER; v_diff INTEGER;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'cash', 'shift.opened', 'shift', NEW.id,
      'abrió la caja con una base de ' || public._m(NEW.opening_balance::INTEGER),
      'info', NEW.opening_balance::INTEGER, NULL, NULL);
  ELSIF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    v_expected := COALESCE(NEW.opening_balance, 0)
      + (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN sales s ON s.id = p.sale_id
          WHERE p.shift_id = NEW.id AND p.payment_method = 'cash' AND s.status <> 'voided')
      - (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE shift_id = NEW.id AND payment_method = 'cash_register')
      - (SELECT COALESCE(SUM(amount), 0) FROM staff_ledger
          WHERE shift_id = NEW.id AND payment_method = 'cash_register' AND entry_type IN ('advance', 'payment'))
      - (SELECT COALESCE(SUM(total_cost), 0) FROM inventory_movements
          WHERE shift_id = NEW.id AND payment_method = 'cash_register' AND movement_type = 'purchase');
    v_diff := COALESCE(NEW.actual_closing_balance, 0)::INTEGER - v_expected;
    PERFORM public._audit(NEW.business_id, 'cash', 'shift.closed', 'shift', NEW.id,
      'cerró la caja: contó ' || public._m(COALESCE(NEW.actual_closing_balance, 0)::INTEGER)
        || ', se esperaban ' || public._m(v_expected)
        || CASE WHEN v_diff = 0 THEN ' · cuadró'
                WHEN v_diff < 0 THEN ' · faltaron ' || public._m(-v_diff)
                ELSE ' · sobraron ' || public._m(v_diff) END,
      CASE WHEN v_diff <> 0 THEN 'warning' ELSE 'info' END, v_diff, NULL,
      jsonb_build_object('esperado', v_expected, 'contado', NEW.actual_closing_balance, 'diferencia', v_diff));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Citas: cancelaciones y "no asistió" ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_appointments()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_client TEXT; v_service TEXT;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('cancelled', 'no_show') THEN RETURN NEW; END IF;
  SELECT full_name INTO v_client FROM customers WHERE id = NEW.customer_id;
  SELECT name INTO v_service FROM services WHERE id = NEW.service_id;
  PERFORM public._audit(NEW.business_id, 'appointments', 'appointment.' || NEW.status, 'appointment', NEW.id,
    CASE WHEN NEW.status = 'cancelled' THEN 'canceló la cita de ' ELSE 'marcó "no asistió" a ' END
      || COALESCE(v_client, 'un cliente') || COALESCE(' (' || v_service || ', '
      || to_char(NEW.start_time AT TIME ZONE 'UTC', 'DD/MM HH24:MI') || ')', '')
      || COALESCE(' · motivo: ' || NULLIF(NEW.cancellation_reason, ''), ''),
    'info', NULL, jsonb_build_object('estado', OLD.status), jsonb_build_object('estado', NEW.status));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Equipo ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_staff()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._audit(NEW.business_id, 'team', 'staff.created', 'staff', NEW.id,
      'agregó a ' || NEW.full_name || ' al equipo', 'info', NULL, NULL, NULL);
  ELSE
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      PERFORM public._audit(NEW.business_id, 'team', 'staff.status_changed', 'staff', NEW.id,
        CASE WHEN NEW.is_active THEN 'activó a ' ELSE 'desactivó a ' END || NEW.full_name,
        CASE WHEN NEW.is_active THEN 'info' ELSE 'warning' END, NULL, NULL, NULL);
    END IF;
    IF NEW.full_name IS DISTINCT FROM OLD.full_name OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      PERFORM public._audit(NEW.business_id, 'team', 'staff.updated', 'staff', NEW.id,
        'editó los datos de ' || NEW.full_name
          || CASE WHEN NEW.user_id IS DISTINCT FROM OLD.user_id THEN ' (usuario de acceso)' ELSE '' END,
        'info', NULL,
        jsonb_build_object('nombre', OLD.full_name, 'usuario', OLD.user_id),
        jsonb_build_object('nombre', NEW.full_name, 'usuario', NEW.user_id));
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ── Configuración del negocio ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_audit_businesses()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  o JSONB := to_jsonb(OLD);
  n JSONB := to_jsonb(NEW);
  k TEXT;
  changed TEXT[] := '{}';
  keys TEXT[] := ARRAY['loyalty_mode', 'loyalty_earn_per_cop', 'loyalty_point_value_cop', 'loyalty_min_redeem_points',
                       'loyalty_expiry_months', 'loyalty_stamps_required', 'loyalty_stamp_max_reward_cop',
                       'booking_products_enabled', 'booking_max_product_units', 'booking_max_open_with_products_per_phone',
                       'service_audiences', 'features_enabled', 'appointment_interval_minutes', 'operating_hours',
                       'name', 'is_active'];
BEGIN
  FOREACH k IN ARRAY keys LOOP
    IF o -> k IS DISTINCT FROM n -> k THEN changed := changed || k; END IF;
  END LOOP;
  IF array_length(changed, 1) IS NULL THEN RETURN NEW; END IF;
  PERFORM public._audit(NEW.id, 'settings', 'business.settings_changed', 'business', NEW.id,
    'cambió la configuración: ' || array_to_string(ARRAY(
      SELECT CASE
               WHEN c LIKE 'loyalty_%' THEN 'lealtad'
               WHEN c LIKE 'booking_%' THEN 'reservas en línea'
               WHEN c = 'service_audiences' THEN 'públicos de servicios'
               WHEN c = 'features_enabled' THEN 'módulos'
               WHEN c IN ('appointment_interval_minutes', 'operating_hours') THEN 'horario del negocio'
               WHEN c = 'name' THEN 'nombre'
               ELSE 'estado del negocio' END
        FROM unnest(changed) c GROUP BY 1), ', '),
    CASE WHEN 'features_enabled' = ANY (changed) OR 'is_active' = ANY (changed) THEN 'warning' ELSE 'info' END,
    NULL,
    (SELECT jsonb_object_agg(c, o -> c) FROM unnest(changed) c),
    (SELECT jsonb_object_agg(c, n -> c) FROM unnest(changed) c));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'audit %: %', TG_TABLE_NAME, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Ninguna función de trigger se llama directo
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['_trg_audit_sales', '_trg_audit_staff_ledger', '_trg_audit_expenses',
                           '_trg_audit_commission_rules', '_trg_audit_services', '_trg_audit_inventory_items',
                           '_trg_audit_inventory_movements', '_trg_audit_loyalty', '_trg_audit_shifts',
                           '_trg_audit_appointments', '_trg_audit_staff', '_trg_audit_businesses'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public._commission_rule_text(public.commission_rules) FROM PUBLIC, anon, authenticated;

-- ── Triggers ─────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_audit_sales ON public.sales;
CREATE TRIGGER trg_audit_sales AFTER INSERT OR UPDATE OF status ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_sales();

DROP TRIGGER IF EXISTS trg_audit_staff_ledger ON public.staff_ledger;
CREATE TRIGGER trg_audit_staff_ledger AFTER INSERT ON public.staff_ledger
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_staff_ledger();

DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses;
CREATE TRIGGER trg_audit_expenses AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_expenses();

DROP TRIGGER IF EXISTS trg_audit_commission_rules ON public.commission_rules;
CREATE TRIGGER trg_audit_commission_rules AFTER INSERT OR UPDATE OR DELETE ON public.commission_rules
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_commission_rules();

DROP TRIGGER IF EXISTS trg_audit_services ON public.services;
CREATE TRIGGER trg_audit_services AFTER INSERT OR UPDATE OR DELETE ON public.services
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_services();

DROP TRIGGER IF EXISTS trg_audit_inventory_items ON public.inventory_items;
CREATE TRIGGER trg_audit_inventory_items AFTER INSERT OR UPDATE OF unit_price, is_active ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_inventory_items();

DROP TRIGGER IF EXISTS trg_audit_inventory_movements ON public.inventory_movements;
CREATE TRIGGER trg_audit_inventory_movements AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_inventory_movements();

DROP TRIGGER IF EXISTS trg_audit_loyalty ON public.loyalty_ledgers;
CREATE TRIGGER trg_audit_loyalty AFTER INSERT ON public.loyalty_ledgers
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_loyalty();

DROP TRIGGER IF EXISTS trg_audit_shifts ON public.cash_register_shifts;
CREATE TRIGGER trg_audit_shifts AFTER INSERT OR UPDATE OF status ON public.cash_register_shifts
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_shifts();

DROP TRIGGER IF EXISTS trg_audit_appointments ON public.appointments;
CREATE TRIGGER trg_audit_appointments AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_appointments();

DROP TRIGGER IF EXISTS trg_audit_staff ON public.staff;
CREATE TRIGGER trg_audit_staff AFTER INSERT OR UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_staff();

DROP TRIGGER IF EXISTS trg_audit_businesses ON public.businesses;
CREATE TRIGGER trg_audit_businesses AFTER UPDATE ON public.businesses
  FOR EACH ROW EXECUTE FUNCTION public._trg_audit_businesses();

-- ── log_action: negocio verificado y actor de la sesión ──────────────────────
CREATE OR REPLACE FUNCTION public.log_action(
  p_business_id  UUID,
  p_actor_id     UUID,
  p_actor_name   TEXT,
  p_action       TEXT,
  p_entity_type  TEXT,
  p_entity_id    UUID    DEFAULT NULL,
  p_old_value    JSONB   DEFAULT NULL,
  p_new_value    JSONB   DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  a    RECORD;
BEGIN
  PERFORM public._assert_business_access(p_business_id);
  SELECT * INTO a FROM public._audit_actor();
  INSERT INTO audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id, old_value, new_value)
  VALUES (p_business_id, a.actor_id, a.actor_name, LEFT(p_action, 80), LEFT(p_entity_type, 40), p_entity_id,
          p_old_value, p_new_value)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.log_action(UUID, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_action(UUID, UUID, TEXT, TEXT, TEXT, UUID, JSONB, JSONB) TO authenticated, service_role;

-- ── RLS: solo el admin lee; nadie escribe directo ────────────────────────────
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
            WHERE schemaname = 'public' AND tablename = 'audit_logs' AND NOT ('service_role' = ANY (roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.audit_logs', p.policyname);
  END LOOP;
END $$;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY xin_admin_select ON public.audit_logs FOR SELECT TO authenticated
  USING (business_id::TEXT = (auth.jwt() -> 'app_metadata' ->> 'business_id')
         AND public._is_business_admin(business_id));
