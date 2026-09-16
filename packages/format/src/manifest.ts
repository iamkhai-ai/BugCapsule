import * as z from 'zod'
import { FormatVersionSchema, IsoTimestampSchema, UrlRefSchema } from './common'

/** Producer của capsule. Không ràng buộc — third party được khuyến khích. */
export const SourceSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
})
export type Source = z.infer<typeof SourceSchema>

export const CaptureWindowSchema = z.object({
  startedAt: IsoTimestampSchema,
  endedAt: IsoTimestampSchema,
  durationMs: z.number().nonnegative(),
})
export type CaptureWindow = z.infer<typeof CaptureWindowSchema>

/**
 * Vai trò của capsule trong một phép so sánh.
 *
 * Optional để giữ cho capsule tối thiểu (spec §29) vẫn hợp lệ. Reader MUST
 * coi field thiếu là `"unknown"`.
 */
export const CapsuleRoleSchema = z.enum(['working', 'broken', 'unknown'])
export type CapsuleRole = z.infer<typeof CapsuleRoleSchema>

/**
 * Bản đồ tên logic → đường dẫn entry trong archive.
 *
 * Mọi giá trị MUST là đường dẫn tương đối, không chứa `..`, không bắt đầu bằng
 * `/`, và MUST trỏ tới một entry nằm trong chính archive đó (spec §26).
 */
export const ManifestFilesSchema = z.object({
  environment: z.string().optional(),
  actions: z.string().optional(),
  network: z.string().optional(),
  console: z.string().optional(),
  state: z.string().optional(),
  privacy: z.string().optional(),
  screenshot: z.string().optional(),
})
export type ManifestFiles = z.infer<typeof ManifestFilesSchema>

export const ManifestSchema = z.object({
  format: z.literal('bugcapsule'),
  formatVersion: FormatVersionSchema,
  id: z.string().min(1),
  createdAt: IsoTimestampSchema,
  source: SourceSchema,
  capture: CaptureWindowSchema,
  role: CapsuleRoleSchema.optional(),
  page: UrlRefSchema.optional(),
  files: ManifestFilesSchema.optional(),
  /**
   * Các khoảng trống đã biết của phiên capture, dạng mã ngắn
   * (`"workers-not-captured"`, `"missed-before-inject"`, `"sw-restarted"`, ...).
   * Khai báo trung thực để consumer không săn dữ liệu không tồn tại.
   */
  captureGaps: z.array(z.string()).optional(),
})
export type Manifest = z.infer<typeof ManifestSchema>
