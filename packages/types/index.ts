/**
 * @xinuco/types — Tipos compartidos de la plataforma Xinuco.
 * Incluye: Database, Business, UserRole, BusinessFeatures, etc.
 */
export type {
  Json,
  Database,
  Business,
  BusinessInsert,
  BusinessFeatures,
  BrandConfig,
  Profile,
  UserRole,
  Service,
  ServiceAudience,
  ServiceAudienceOrAll,
  Staff,
  StaffRole,
  StaffSchedule,
  StaffBreak,
  StaffTimeOff,
  StaffTimeOffKind,
  Appointment,
  AppointmentStatus,
  Customer,
  SaleItem,
  CommissionRule,
  LedgerEntryType,
  StaffLedgerEntry,
  StaffLedgerBalance,
} from './database'

export type { Database as DatabaseGenerated } from './database.types'
