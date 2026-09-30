// ============================================================
// types/database.ts  —  "The Vault" — Tipos estrictos de Xinuco
// ============================================================

// ---------- Tipo base para columnas JSONB de PostgreSQL ----------
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[]

// ---------- Branding del tenant ----------
export interface BusinessBranding {
  primary_color:   string   // Ej: "#C5A059"
  secondary_color: string   // Surface / cards
  bg_color:        string   // Fondo principal
  text_color:      string   // Texto principal
  logo_url:        string | null
  font_family:     string   // Ej: "Inter" | "Bebas Neue"
}

// ---------- Brand Config (columna JSONB: brand_config) — FUENTE ÚNICA DE VERDAD ----------
export interface BrandConfig {
  primaryColor:    string   // Hex: "#C5A059"
  secondaryColor:  string   // Surface / cards: "#1A1A1A"
  bgColor:         string   // Fondo principal: "#080808"
  textColor:       string   // Texto principal: "#F4F4F4"
  fontFamily:      string   // Ej: "inter" | "playfair" | "oswald"
  logoUrl?:        string   // URL del logo (opcional)
}

// ---------- Feature Flags ----------
export interface BusinessFeatures {
  // ── Comunicación ─────────────────────────────────────────────────
  notifications_email:     boolean  // RF18 - Confirmaciones/recordatorios por correo (Resend)
  notifications_whatsapp:  boolean  // RF18 - Notificaciones por WhatsApp Cloud API
  // ── Finanzas ─────────────────────────────────────────────────────
  commissions:             boolean  // RF14 - Motor de comisiones variables
  staff_ledger:            boolean  // RF15 - Pagos al equipo / Mi cuenta
  expenses_pgl:            boolean  // RF16 - Gastos y estado de resultados P&G
  retail_sales:            boolean  // RF20 - Ventas directas de productos (sin cita)
  loyalty:                 boolean  // RF17 - Programa de puntos de lealtad
  // ── Operaciones ──────────────────────────────────────────────────
  workstations:            boolean  // RF5  - Gestión de puestos de trabajo
  walk_ins:                boolean  // RF8  - Cola de walk-ins (próximo)
  crm:                     boolean  // RF9  - Expediente del cliente (próximo)
  // ── Compliance / Admin ───────────────────────────────────────────
  audit_logs:              boolean  // RF19 - Logs de auditoría inmutables
  fixed_assets:            boolean  // RF21 - Activos fijos (próximo)
  // ── MercadoPago (RF-MP) ──────────────────────────────────────────
  mercadopago_pos?:        boolean  // POS en local: generar QR/link en dashboard
  mercadopago_booking?:    boolean  // Pago online al reservar cita (BookingWizard)
  mercadopago_saas?:       boolean  // Suscripción SaaS cobrada via MP
  // ── Legacy ───────────────────────────────────────────────────────
  inventory:               boolean
  advanced_reports:        boolean
}

// ---------- Operating Hours ----------
export interface DayHours {
  is_open: boolean
  open_time: string
  close_time: string
}

export interface OperatingHours {
  monday: DayHours
  tuesday: DayHours
  wednesday: DayHours
  thursday: DayHours
  friday: DayHours
  saturday: DayHours
  sunday: DayHours
}

// ---------- Tabla: businesses ----------
export interface Business {
  id:               string             // UUID
  name:             string
  slug:             string             // Identificador único de URL
  is_active:        boolean
  branding:         BusinessBranding
  features_enabled: BusinessFeatures
  brand_config:     BrandConfig        // JSONB — tema visual del tenant
  operating_hours?: OperatingHours     // JSONB
  workstations_count?: number          // INT — deprecado: usar tabla workstations
  // ── Configuración operativa ──────────────────────────────────────────────
  appointment_interval_minutes?: number  // 15 | 30 — granularidad de slots en el calendario
  service_audiences?: ServiceAudience[]  // TEXT[] — públicos que atiende ('men' | 'women' | 'kids'); por defecto ['men']
  // ── Programa de lealtad ──────────────────────────────────────────────────
  loyalty_point_value_cop?: number       // COP que equivale 1 punto (ej: 1000 = $1.000 COP)
  loyalty_expiry_months?:   number       // Meses de vigencia de los puntos
  // ── Productos apartados en la reserva en línea ───────────────────────────
  booking_products_enabled?:                 boolean  // permite apartar productos al reservar
  booking_max_product_units?:                number   // 0–50 — unidades máx. por cita (0 = desactivado)
  booking_max_open_with_products_per_phone?: number   // 0–50 — citas abiertas con productos por teléfono (0 = sin límite)
  // ── SaaS Billing (RF23) — columnas pendientes de migración ───────────────
  stripe_customer_id?:      string | null
  subscription_status?:     'active' | 'past_due' | 'canceled' | 'trialing' | null
  // ── Trial Mode — acceso temporal con fecha de vencimiento ────────────────
  trial_expires_at?:        string | null   // ISO timestamp — null = sin trial activo
  created_at:       string
}

// ---------- Tabla: profiles ----------
export type UserRole = 'super_admin' | 'admin' | 'barber' | 'manicurist'

export interface Profile {
  id:          string     // UUID — mismo que auth.users.id
  business_id: string     // UUID → businesses.id
  full_name:   string
  role:        UserRole
  avatar_url:  string | null
  created_at:  string
}

// ---------- Tabla: customers ----------
export interface Customer {
  id:                 string
  business_id:        string
  full_name:          string
  phone:              string
  email:              string | null
  preferred_staff_id: string | null  // RF9 — barbero preferido
  created_at:         string
  updated_at:         string
}

// ---------- RF9 — CRM: customer_notes ----------
export interface CustomerNote {
  id:             string
  business_id:    string
  customer_id:    string
  staff_id:       string | null   // quién escribió la nota
  appointment_id: string | null   // nota asociada a una cita (opcional)
  content:        string
  created_at:     string
}

// ---------- RF9 — CRM: customer_tags ----------
export interface CustomerTag {
  customer_id: string
  business_id: string
  tag:         string
}

// ---------- Tabla: appointments ----------
export type AppointmentStatus = 'payment_pending' | 'scheduled' | 'in_progress' | 'ready_to_pay' | 'completed' | 'cancelled' | 'no_show';
export type ShiftStatus = 'open' | 'closed';
export type SaleStatus = 'pending' | 'paid' | 'voided';
export type ItemType = 'service' | 'product';
export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'loyalty_points' | 'mixed' | 'mercadopago';

export interface Appointment {
  id:            string
  business_id:   string
  staff_id:      string | null 
  customer_id:   string
  service_id:    string
  status:        AppointmentStatus
  // -- DEPRECADO: Mantenido temporalmente para compatibilidad UI --
  customer_name?: string
  customer_phone?: string | null
  service_name?:  string | null
  barber_id?:     string | null
  // ---------------------------------------------------------------
  /**
   * TSTZRANGE viene de Supabase como string con formato:
   * '["2025-01-01 10:00:00+00","2025-01-01 11:00:00+00")'
   * Parsear con parseTimeRange() de @/lib/utils/time
   */
  time_range?:    string
  start_time?:    string
  notes:         string | null
  created_at:    string
  updated_at:    string
}

// ---------- Tabla: services ----------
/** Público al que se dirige un servicio. */
export type ServiceAudience = 'men' | 'women' | 'kids'
/** Igual que ServiceAudience, más 'all' (unisex: aparece en todos los públicos). */
export type ServiceAudienceOrAll = ServiceAudience | 'all'

export interface Service {
  id:                   string
  business_id:          string
  name:                 string
  description:          string | null
  duration_minutes:     number
  buffer_time_minutes:  number   // Tiempo de limpieza/preparación post-servicio (sumado a duration para calcular slots)
  price_cop:            number   // Precio en COP como INTEGER (sin decimales)
  audience?:            ServiceAudienceOrAll  // Público del servicio; 'all' = unisex. Por defecto 'men'
  is_active:            boolean
  created_at:           string
  updated_at:           string
}

// ---------- Tabla: staff ----------
export type StaffRole = 'super_admin' | 'admin' | 'barber' | 'manicurist'

export interface Staff {
  id:             string
  business_id:    string
  user_id?:       string | null  // UUID → auth.users.id (null si el empleado no tiene cuenta)
  email?:         string | null  // opcional: a dónde llegan los recibos de anticipos y pagos
  phone?:         string | null  // opcional: WhatsApp / celular (dígitos, '+' opcional)
  name?:          string         // deprecado (mantener por compatibilidad temporal si es necesario)
  full_name:      string
  specialty_role: string
  role?:          StaffRole      // deprecado
  is_active:      boolean
  created_at:     string
  updated_at:     string
}

// ---------- Tabla: staff_services (pivot) ----------
export interface StaffService {
  staff_id:    string   // → staff.id
  service_id:  string   // → services.id
  business_id: string   // → businesses.id (redundante para RLS)
}

// ---------- Tabla: staff_schedules ----------
export interface StaffSchedule {
  id:          string
  business_id: string   // → businesses.id
  staff_id:    string   // → staff.id
  day_of_week: number   // 0 = Domingo, 1 = Lunes … 6 = Sábado
  start_time:  string   // TIME, ej: '09:00'
  end_time:    string   // TIME, ej: '18:00'
}

// ---------- Tabla: staff_breaks (pausas recurrentes por día de la semana) ----------
export interface StaffBreak {
  id:          string
  business_id: string   // → businesses.id
  staff_id:    string   // → staff.id
  day_of_week: number   // 0 = Domingo … 6 = Sábado
  start_time:  string   // TIME, ej: '12:00:00'
  end_time:    string   // TIME, ej: '13:00:00'
  label:       string   // ≤ 60 chars, default 'Almuerzo'
  created_at:  string
}

// ---------- Tabla: staff_time_off (bloqueos puntuales) ----------
export type StaffTimeOffKind = 'permission' | 'vacation' | 'sick' | 'other'

export interface StaffTimeOff {
  id:          string
  business_id: string   // → businesses.id
  staff_id:    string   // → staff.id
  /** Hora LOCAL del negocio guardada como UTC (ver apps/barberia/lib/agenda-time.ts) */
  starts_at:   string
  ends_at:     string
  kind:        StaffTimeOffKind
  reason:      string | null   // ≤ 200 chars
  created_by:  string | null   // → auth.users.id
  created_at:  string
}

// ---------- Helpers tipados ----------
/**
 * Tipo Row genérico para cualquier tabla — facilita la generación de inserts
 */
export type InsertRow<T extends { id: string; created_at: string }> =
  Omit<T, 'id' | 'created_at'>

export type BusinessInsert   = InsertRow<Business>
export type ProfileInsert    = InsertRow<Profile>
export type AppointmentInsert= InsertRow<Appointment> & { updated_at?: string }

// ---------- Database (shape para @supabase/ssr) ----------
export interface Database {
  public: {
    Tables: {
      businesses: {
        Row:    Business
        Insert: BusinessInsert
        Update: Partial<BusinessInsert>
      }
      profiles: {
        Row:    Profile
        Insert: ProfileInsert
        Update: Partial<ProfileInsert>
      }
      appointments: {
        Row:    Appointment
        Insert: AppointmentInsert
        Update: Partial<AppointmentInsert>
      }
      customers: {
        Row:    Customer
        Insert: Omit<Customer, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Customer, 'id' | 'created_at' | 'updated_at'>>
      }
      services: {
        Row:    Service
        Insert: Omit<Service, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Service, 'id' | 'created_at' | 'updated_at'>>
      }
      staff: {
        Row:    Staff
        Insert: Omit<Staff, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<Staff, 'id' | 'created_at' | 'updated_at'>>
      }
      staff_services: {
        Row:    StaffService
        Insert: StaffService
        Update: Partial<StaffService>
      }
      staff_schedules: {
        Row:    StaffSchedule
        Insert: Omit<StaffSchedule, 'id'>
        Update: Partial<Omit<StaffSchedule, 'id'>>
      }
      staff_breaks: {
        Row:    StaffBreak
        Insert: Omit<StaffBreak, 'id' | 'created_at'>
        Update: Partial<Omit<StaffBreak, 'id' | 'created_at'>>
      }
      staff_time_off: {
        Row:    StaffTimeOff
        Insert: Omit<StaffTimeOff, 'id' | 'created_at'>
        Update: Partial<Omit<StaffTimeOff, 'id' | 'created_at'>>
      }
      cash_register_shifts: {
        Row:    CashRegisterShift
        // closed_by, closed_at y actual_closing_balance son NULL al abrir turno → opcionales en Insert
        Insert: Omit<CashRegisterShift, 'id' | 'created_at' | 'closed_by' | 'closed_at' | 'actual_closing_balance'> & {
          closed_by?:               string | null
          closed_at?:               string | null
          actual_closing_balance?:  number | null
        }
        Update: Partial<Omit<CashRegisterShift, 'id' | 'created_at'>>
      }
      sales: {
        Row:    Sale
        Insert: Omit<Sale, 'id' | 'created_at'>
        Update: Partial<Omit<Sale, 'id' | 'created_at'>>
      }
      sale_items: {
        Row:    SaleItem
        Insert: Omit<SaleItem, 'id' | 'created_at'>
        Update: Partial<Omit<SaleItem, 'id' | 'created_at'>>
      }
      payments: {
        Row:    Payment
        Insert: Omit<Payment, 'id' | 'created_at'>
        Update: Partial<Omit<Payment, 'id' | 'created_at'>>
      }
      staff_ledger: {
        Row:    StaffLedgerEntry
        Insert: Omit<StaffLedgerEntry, 'id' | 'created_at'>
        Update: never
      }
      expenses: {
        Row:    Expense
        Insert: Omit<Expense, 'id' | 'created_at' | 'updated_at' | 'payment_method' | 'shift_id'> & {
          payment_method?: ExpensePaymentMethod
          shift_id?:       string | null
        }
        Update: Partial<Omit<Expense, 'id' | 'created_at' | 'updated_at'>>
      }
      expense_categories: {
        Row:    ExpenseCategoryRow
        Insert: Omit<ExpenseCategoryRow, 'id' | 'created_at' | 'is_hidden' | 'sort_order' | 'color'> & {
          is_hidden?:  boolean
          sort_order?: number
          color?:      string | null
        }
        Update: Partial<Omit<ExpenseCategoryRow, 'id' | 'business_id' | 'created_at'>>
      }
      walk_ins: {
        Row:    WalkIn
        Insert: Omit<WalkIn, 'id' | 'created_at' | 'arrived_at'> & { arrived_at?: string }
        Update: Partial<Omit<WalkIn, 'id' | 'created_at'>>
      }
      fixed_assets: {
        Row:    FixedAsset
        Insert: Omit<FixedAsset, 'id' | 'created_at'>
        Update: Partial<Omit<FixedAsset, 'id' | 'created_at' | 'business_id'>>
      }
      inventory_items: {
        Row:    InventoryItem
        Insert: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<InventoryItem, 'id' | 'created_at' | 'business_id'>>
      }
      appointment_products: {
        Row:    AppointmentProduct
        Insert: Omit<AppointmentProduct, 'id' | 'created_at'>
        Update: never
      }
      inventory_movements: {
        Row:    InventoryMovement
        Insert: Omit<InventoryMovement, 'id' | 'created_at'>
        Update: never
      }
    }
    Views: {
      staff_ledger_balances: {
        Row: StaffLedgerBalance
      }
    }
    Functions: {
      // RPC atómico de cobro — reemplaza 4 inserts separados con una transacción real
      checkout_appointment: {
        Args: {
          p_appointment_id:  string
          p_business_id:     string
          p_shift_id:        string
          p_payment_method:  string
          p_tip_amount?:     number
          p_discount_amount?: number
          p_items?:          Json
        }
        Returns: Json
      }
      // RPC de disponibilidad de slots — calcula huecos libres en el calendario
      get_available_slots: {
        Args: {
          p_business_id:      string
          p_staff_id:         string | null
          p_date:             string
          p_duration_minutes: number
        }
        Returns: Json
      }
      // RPC v2 — Agendamiento Tri-factorial (RF7): staff + workstation + intervalo del negocio
      get_available_slots_v2: {
        Args: {
          p_business_id:      string
          p_staff_id:         string | null
          p_service_id:       string | null
          p_date:             string
          p_duration_minutes: number
        }
        Returns: Json
      }
      // RPC atómico de venta retail (sin cita asociada) — RF20
      create_retail_sale: {
        Args: {
          p_business_id:     string
          p_shift_id:        string
          p_customer_id?:    string | null
          p_payment_method:  string
          p_tip_amount?:     number
          p_discount_amount?: number
          p_items?:          Json
        }
        Returns: Json
      }
      // RPC Motor de Comisiones (RF14) — calcula comisión para una cita individual
      calculate_commission: {
        Args: {
          p_appointment_id: string
          p_business_id:    string
        }
        Returns: Json
      }
      // RPC Motor de Comisiones (RF14) — procesa la cola completa de un negocio (cron job)
      process_commission_queue: {
        Args: {
          p_business_id: string
        }
        Returns: Json
      }
      // RPC de seguridad — inyecta el slug del tenant en app_metadata del JWT
      secure_set_user_context: {
        Args: { business_slug: string }
        Returns: void
      }
      // RPC público (SECURITY DEFINER) — un negocio con solo campos seguros, sin exponer la tabla businesses
      get_public_business: {
        Args: {
          p_slug?: string | null
          p_id?:   string | null
        }
        Returns: {
          id:                  string
          name:                string
          slug:                string
          is_active:           boolean
          branding:            Json
          brand_config:        Json
          online_payments:     boolean   // = features_enabled.mercadopago_booking
          email_notifications: boolean   // = features_enabled.notifications_email
        }[]
      }
      // RPC Caja — totales del turno calculados en el servidor (ventas, cobros en efectivo,
      // gastos y pagos al equipo pagados con efectivo de la caja)
      get_shift_cash_summary: {
        Args: { p_shift_id: string }
        Returns: Json
      }
      // RPC P&G (RF16) — Calcula el estado de resultados de un negocio en un período
      get_profit_loss: {
        Args: {
          p_business_id: string
          p_date_from:   string
          p_date_to:     string
        }
        Returns: Json
      }
      // RPC Auditoría (RF19) — Inserta una entrada inmutable en audit_logs
      log_action: {
        Args: {
          p_business_id:  string
          p_actor_id:     string | null
          p_actor_name:   string | null
          p_action:       string
          p_entity_type:  string
          p_entity_id?:   string | null
          p_old_value?:   Json | null
          p_new_value?:   Json | null
        }
        Returns: string   // UUID del log insertado
      }
      // RPC Lealtad (RF17) — Otorga puntos al cliente tras un cobro
      earn_loyalty_points: {
        Args: {
          p_business_id:           string
          p_client_id:             string
          p_sale_amount:           number
          p_transaction_reference: string
        }
        Returns: Json
      }
      // RPC Lealtad (RF17) — Canjea puntos como descuento en COP
      redeem_loyalty_points: {
        Args: {
          p_business_id:           string
          p_client_id:             string
          p_points_to_redeem:      number
          p_transaction_reference: string
        }
        Returns: Json
      }
      // RPC Lealtad (RF17) — Retorna saldo activo de puntos de un cliente
      get_client_loyalty_balance: {
        Args: {
          p_business_id: string
          p_client_id:   string
        }
        Returns: Json
      }
      // RPC Staff Ledger (RF15) — Registra comisión y propina en el ledger
      record_commission_to_ledger: {
        Args: {
          p_appointment_id:   string
          p_business_id:      string
          p_staff_id:         string
          p_commission_amount: number
          p_tip_amount:       number
        }
        Returns: void
      }
      // RPC Activos Fijos (RF21) — Calcula el cronograma de depreciación de un activo
      get_depreciation_schedule: {
        Args: {
          p_business_id: string
          p_asset_id:    string
        }
        Returns: Json
      }
      // RPC Activos Fijos (RF21) — Suma el valor en libros de todos los activos activos
      get_total_asset_value: {
        Args: {
          p_business_id: string
        }
        Returns: Json
      }
      // RPC Contabilidad (RF22) — Resumen de ingresos, egresos y posición neta por período
      get_accounting_summary: {
        Args: { p_business_id: string; p_date_from: string; p_date_to: string }
        Returns: Json
      }
      // RPC Inventario — Registra un movimiento de stock de forma atómica
      record_inventory_movement: {
        Args: {
          p_business_id:   string
          p_item_id:       string
          p_quantity:      number
          p_type:          string
          p_notes?:        string | null
          p_reference_id?: string | null
          p_user_id?:      string | null
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ---------- Módulos de Caja y Ventas ----------
export interface CashRegisterShift {
  id: string;
  business_id: string;
  opened_by: string | null;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  status: ShiftStatus;
  opening_balance: number;
  actual_closing_balance: number | null;
  created_at: string;
}

export interface Sale {
  id: string;
  business_id: string;
  shift_id: string;
  appointment_id: string | null;
  customer_id: string | null;
  subtotal: number;
  discount_amount: number;
  tip_amount: number;
  total_amount: number;
  status: SaleStatus;
  created_at: string;
}

export interface SaleItem {
  id: string;
  business_id: string;
  sale_id: string;
  staff_id: string | null;
  item_type: ItemType;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  created_at: string;
}

export interface Payment {
  id: string;
  business_id: string;
  sale_id: string;
  shift_id: string;
  amount: number;
  payment_method: PaymentMethod;
  created_at: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// RF19 — Audit Logs (Immutable Audit Trail)
// ══════════════════════════════════════════════════════════════════════════════

// ---------- Tabla: audit_logs ----------
export type AuditCategory =
  | 'money' | 'cash' | 'inventory' | 'appointments' | 'team' | 'settings' | 'customers'

export interface AuditLog {
  id:          string
  business_id: string
  actor_id:    string | null
  actor_name:  string | null
  action:      string
  entity_type: string
  entity_id:   string | null
  old_value:   Json | null
  new_value:   Json | null
  ip_address:  string | null
  created_at:  string
  /** Null en registros antiguos (anteriores a los triggers de auditoría). */
  category:    string | null
  /** Frase en español SIN el actor. Null en registros antiguos. */
  summary:     string | null
  severity:    'info' | 'warning'
  /** Monto relevante (shift.closed: diferencia, negativo = faltante). */
  amount:      number | null
}

// ══════════════════════════════════════════════════════════════════════════════
// SPRINT 3 — Tablas confirmadas por The Vault (pendientes de migración en Supabase)
// ══════════════════════════════════════════════════════════════════════════════

// ---------- Tabla: workstations (RF5) ----------
export interface Workstation {
  id:          string   // UUID
  business_id: string   // UUID → businesses.id
  name:        string   // Ej: "Silla 1", "Spa Pedicure A"
  is_active:   boolean
  created_at:  string
}

// ---------- Tabla: service_workstations (pivot RF5 ↔ RF7) ----------
// Vincula qué tipos de workstation requiere cada servicio
export interface ServiceWorkstation {
  service_id:     string   // UUID → services.id
  workstation_id: string   // UUID → workstations.id
  business_id:    string   // UUID → businesses.id (redundante para RLS)
}

// ---------- Tabla: commission_rules (RF14) ----------
// Lógica de cascada: staff+service > solo staff > regla global del negocio
export interface CommissionRule {
  id:                    string
  business_id:           string          // UUID → businesses.id
  staff_id:              string | null   // null = aplica a todos
  service_id:            string | null   // null = aplica a todos los servicios
  commission_percentage: number          // INTEGER: ej. 40 = 40%
  fixed_amount:          number          // INTEGER COP — alternativa al porcentaje
  product_percentage:    number          // INTEGER 0–100: % sobre productos vendidos (solo reglas sin servicio)
  created_at:            string
}

// ---------- Tabla: commission_queue (trigger on_appointment_status_change) ----------
// Cola transaccional que el trigger inserta al completar una cita
// Un Cron Job / Webhook la procesa en segundo plano
export interface CommissionQueueEntry {
  id:             string
  appointment_id: string    // UUID → appointments.id
  processed:      boolean
  created_at:     string
}

// ---------- Tabla: staff_ledger (RF15) ----------
export type LedgerEntryType = 'commission' | 'tip' | 'advance' | 'payment' | 'bonus' | 'deduction'

/** De dónde salió la plata en un pago/anticipo al equipo. 'cash_register' = efectivo de la caja. */
export type TeamPaymentMethod = 'cash_register' | 'transfer' | 'other'

export interface StaffLedgerEntry {
  id:           string
  business_id:  string          // UUID → businesses.id
  staff_id:     string          // UUID → staff.id
  entry_type:   LedgerEntryType
  amount:       number          // INTEGER COP — siempre positivo
  notes:        string | null
  reference_id: string | null   // UUID → appointments.id o sales.id
  created_at:   string
  sale_id?:      string | null  // UUID → sales.id (comisiones/propinas automáticas)
  sale_item_id?: string | null  // UUID → sale_items.id (una comisión por línea)
  payment_method?: TeamPaymentMethod | null  // solo en pagos y anticipos
  shift_id?:     string | null  // UUID → cash_register_shifts.id (si salió de la caja)
  created_by?:   string | null  // UUID → auth.users.id (quién lo registró)
  period_from?:  string | null  // 'YYYY-MM-DD' — período liquidado (pagos)
  period_to?:    string | null  // 'YYYY-MM-DD'
}

// Vista: staff_ledger_balances — saldo acumulado por empleado
export interface StaffLedgerBalance {
  business_id:    string
  staff_id:       string
  total_earned:   number   // INTEGER COP — comisiones + propinas
  total_advances: number   // INTEGER COP — anticipos
  total_paid_out: number   // INTEGER COP — liquidaciones
  current_balance: number  // INTEGER COP — earned + bonos - advances - paid_out - descuentos
  total_bonus:    number   // INTEGER COP — bonos / a favor
  total_deductions: number // INTEGER COP — descuentos
}

// ---------- Tabla: expenses (RF16) ----------
// Categoría como TEXT libre en BD; las categorías conocidas viven en lib/expense-utils.ts (app).
export type ExpenseCategory =
  | 'rent' | 'utilities' | 'supplies' | 'salary' | 'maintenance' | 'marketing' | 'taxes' | 'other'

/** Cómo se pagó el gasto. 'cash_register' = efectivo de la caja (se resta al arqueo del turno). */
export type ExpensePaymentMethod = 'cash_register' | 'transfer' | 'card' | 'other'

export interface Expense {
  id:             string
  business_id:    string
  category:       ExpenseCategory | (string & {})
  description:    string
  amount:         number   // INTEGER COP — NUNCA FLOAT
  expense_date:   string   // DATE string 'YYYY-MM-DD' (fecha local del negocio)
  is_recurring:   boolean
  created_by:     string | null
  created_at:     string
  payment_method: ExpensePaymentMethod
  shift_id:       string | null   // turno de caja (solo si payment_method = 'cash_register')
  updated_at:     string
  /** true si el cron diario lo registró solo (gasto fijo mensual). */
  auto_registered?: boolean
}

// ---------- Tabla: expense_categories ----------
/** Categoría de gasto de un negocio. `expenses.category` guarda el `slug`. */
export interface ExpenseCategoryRow {
  id:          string
  business_id: string
  slug:        string
  name:        string
  color:       string | null   // clave de la paleta (lib/expense-utils.ts), p. ej. 'blue'
  is_hidden:   boolean
  sort_order:  number
  created_at:  string
}

// ---------- P&G Result (retorno de get_profit_loss RPC) ----------
export interface ProfitLossCategoryEntry {
  category: string
  total:    number
}

export interface ProfitLossResult {
  revenue: {
    services:    number
    retail:      number
    total:       number     // servicios + productos (sin propinas)
    discounts:   number     // descuentos ya restados de los ingresos
    sales_count: number
  }
  tips:          number     // propinas: NO son ingreso del negocio
  cost_of_goods: number     // costo de productos vendidos
  expenses: {
    total:       number
    by_category: ProfitLossCategoryEntry[]
  }
  gross_profit: number      // ingresos − costo de productos
  commissions:  number      // comisiones reales (staff_ledger)
  depreciation:    number   // desgaste de equipos del período (se resta)
  asset_disposals: number   // resultado de dar de baja equipos: ganancia (+) o pérdida (−)
  net_profit:   number      // bruta − comisiones − gastos − desgaste ± bajas de equipos
  margin_pct:   number | null
}

// ══════════════════════════════════════════════════════════════════════════════
// RF8 — Walk-ins (Cola de clientes sin cita)
// ══════════════════════════════════════════════════════════════════════════════

export type WalkInStatus = 'waiting' | 'in_progress' | 'completed' | 'cancelled'

export interface WalkIn {
  id:             string
  business_id:    string
  customer_name:  string
  customer_phone: string | null
  service_id:     string | null
  staff_id:       string | null
  status:         WalkInStatus
  notes:          string | null
  position:       number          // INTEGER — posición en cola
  arrived_at:     string          // TIMESTAMPTZ
  served_at:      string | null   // TIMESTAMPTZ — cuando pasó a completed
  created_at:     string
}

// ---------- Tabla: loyalty_ledgers (RF17) ----------
export interface LoyaltyLedger {
  id:                    string
  business_id:           string          // UUID → businesses.id
  client_id:             string          // UUID → customers.id
  points_added:          number          // INTEGER
  points_redeemed:       number          // INTEGER
  transaction_reference: string | null   // UUID → appointments.id o sales.id
  expires_at:            string | null   // TIMESTAMPTZ
  created_at:            string
}

// ══════════════════════════════════════════════════════════════════════════════
// RF21 — Activos Fijos (Fixed Assets)
// ══════════════════════════════════════════════════════════════════════════════

export type FixedAssetCategory = 'furniture' | 'equipment' | 'technology' | 'improvements' | 'vehicle' | 'other'
export type DepreciationMethod = 'straight_line' | 'declining_balance'
/** Cómo se pagó el equipo (o cómo se recibió lo de su venta). null = activo anterior sin dato. */
export type AssetPaymentMethod = 'cash_register' | 'transfer' | 'other'
export type DisposalReason = 'sold' | 'damaged' | 'stolen' | 'donated' | 'other'

export interface FixedAsset {
  id:                      string
  business_id:             string
  name:                    string
  category:                FixedAssetCategory
  description:             string | null
  serial_number:           string | null
  location:                string | null
  purchase_date:           string            // DATE 'YYYY-MM-DD'
  purchase_price:          number            // INTEGER COP
  salvage_value:           number            // INTEGER COP
  depreciation_method:     DepreciationMethod
  useful_life_months:      number            // INTEGER
  is_active:               boolean
  created_by:              string | null
  created_at:              string
  updated_at:              string
  payment_method:          AssetPaymentMethod | null
  shift_id:                string | null
  // Baja
  disposed_at:             string | null     // DATE 'YYYY-MM-DD'
  disposal_reason:         DisposalReason | null
  disposal_price:          number | null
  disposal_payment_method: AssetPaymentMethod | null
  disposal_shift_id:       string | null
  disposal_notes:          string | null
  book_value_at_disposal:  number | null
}

export interface DepreciationSchedule {
  asset_id:                 string
  name:                     string
  purchase_price:           number
  salvage_value:            number
  current_value:            number
  accumulated_depreciation: number
  months_elapsed:           number
  months_remaining:         number
  monthly_depreciation:     number
  fully_depreciated_on:     string           // DATE 'YYYY-MM-DD'
  is_fully_depreciated:     boolean
  disposed_at:              string | null
  book_value_at_disposal:   number | null
}

export interface AssetPortfolioSummary {
  total_book_value:     number
  total_purchase_price: number
  total_depreciation:   number
  monthly_depreciation: number
  asset_count:          number
}

// ══════════════════════════════════════════════════════════════════════════════
// RF22 — Trazabilidad Contable (Accounting Journal)
// ══════════════════════════════════════════════════════════════════════════════

export type JournalEntryType    = 'income' | 'expense'
export type JournalEntrySubtype = 'sale' | 'operating_expense' | 'staff_payout' | 'asset_depreciation'

export interface JournalEntry {
  entry_id:        string
  business_id:     string
  entry_date:      string   // TIMESTAMPTZ ISO string
  entry_type:      JournalEntryType
  entry_subtype:   JournalEntrySubtype
  description:     string
  amount:          number   // INTEGER COP, always positive
  category:        string | null
  reference_id:    string | null
  reference_table: string | null
}

export interface AccountingSummary {
  total_income:   number   // INTEGER COP
  total_expense:  number   // INTEGER COP
  net_position:   number   // INTEGER COP (can be negative)
  period_from:    string   // DATE string
  period_to:      string   // DATE string
}

// ══════════════════════════════════════════════════════════════════════════════
// Inventario (Inventory Management)
// ══════════════════════════════════════════════════════════════════════════════

export type InventoryCategory = 'general' | 'hair' | 'skincare' | 'tools' | 'other'
export type MovementType = 'purchase' | 'sale' | 'adjustment' | 'waste'

export interface InventoryItem {
  id:            string
  business_id:   string
  name:          string
  sku:           string | null
  category:      InventoryCategory
  description:   string | null
  current_stock: number    // INTEGER
  min_stock:     number    // INTEGER — low stock threshold
  unit_price:    number | null  // INTEGER COP — selling price
  unit_cost:     number | null  // INTEGER COP — purchase cost
  is_active:     boolean
  bookable_online: boolean // ofrecible para apartar en la reserva en línea
  created_by:    string | null
  created_at:    string
  updated_at:    string
}

// Producto apartado por el cliente al reservar (no descuenta stock hasta el cobro)
export interface AppointmentProduct {
  id:             string
  business_id:    string
  appointment_id: string
  item_id:        string
  quantity:       number    // INTEGER > 0
  unit_price:     number    // INTEGER COP — precio congelado al apartar
  created_at:     string
}

export interface InventoryMovement {
  id:            string
  business_id:   string
  item_id:       string
  quantity:      number    // INTEGER — positive=in, negative=out
  movement_type: MovementType
  reference_id:  string | null
  notes:         string | null
  created_by:    string | null
  created_at:    string
  // Compras con costo (migración 20260930140000) — opcionales: filas antiguas no los tienen
  unit_cost?:      number | null   // INTEGER COP
  total_cost?:     number | null   // INTEGER COP
  supplier?:       string | null
  payment_method?: 'cash_register' | 'transfer' | 'other' | null
  shift_id?:       string | null
}

export interface InventoryMovementResult {
  new_stock:      number
  low_stock_warn: boolean
  item_id:        string
}
