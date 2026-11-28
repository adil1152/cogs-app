import { inArray } from "drizzle-orm";
import { db, misAuditLogTable, usersTable } from "@workspace/db";

export function strictDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day));
  return instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day ? value : null;
}
export function dateFromQuery(value: unknown): Date | undefined {
  const parsed = strictDate(value);
  return parsed ? new Date(`${parsed}T00:00:00.000Z`) : undefined;
}
export function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}
export function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 999999999999999;
}
function decimalScaled(value: number | string): bigint {
  const normalize = (n: number | string) => {
    const raw = String(n);
    if (/e/i.test(raw)) throw new Error("Decimal notation must not use an exponent");
    if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error("Invalid decimal number");
    const [whole, fraction = ""] = raw.split(".");
    if (fraction.length > 6) throw new Error("Numbers may contain at most six decimal places");
    return BigInt(`${whole}${fraction.padEnd(6, "0")}`);
  };
  return normalize(value);
}

/** Exact decimal multiplication of API decimal strings, bounded to the database's scale. */
export function multiplyDecimal(left: number, right: number): string {
  // Each operand is scaled by 10^6, so the product is scaled by 10^12.
  // Round half-up to the entry column's fixed six decimal places.
  const value = (decimalScaled(left) * decimalScaled(right) + 500_000n) / 1_000_000n;
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}

/**
 * Divide non-negative decimal values and round only the derived quotient to
 * the existing six-decimal rate scale. The caller persists the source amount
 * separately, so a rounded rate can never reconstruct or change that amount.
 */
export function divideDecimal(numerator: number | string, denominator: number | string): string {
  const numeratorScaled = decimalScaled(numerator);
  const denominatorScaled = decimalScaled(denominator);
  if (denominatorScaled === 0n) return "0.000000";
  const value = (numeratorScaled * 1_000_000n + denominatorScaled / 2n) / denominatorScaled;
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}
export async function auditMis(
  values: {
    entryId?: string | null; projectId?: string | null; entityType: string; entityId: string;
    action: string; actorId: string | null; remarks?: string | null; oldValues?: unknown; newValues?: unknown;
  },
  tx: Pick<typeof db, "insert"> = db,
): Promise<void> {
  await tx.insert(misAuditLogTable).values({
    entryId: values.entryId ?? null, projectId: values.projectId ?? null, entityType: values.entityType,
    entityId: values.entityId, action: values.action, actorId: values.actorId, remarks: values.remarks ?? null,
    oldValues: values.oldValues ?? null, newValues: values.newValues ?? null,
  });
}
export function displayName(user: { email: string | null; firstName: string | null; lastName: string | null }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown user";
}
export async function userMap(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map<string, { id: string; email: string | null; firstName: string | null; lastName: string | null }>();
  const rows = await db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName })
    .from(usersTable).where(inArray(usersTable.id, unique));
  return new Map(rows.map((row) => [row.id, {
    id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName,
  }]));
}
export function userPicker(user: { id: string; email: string | null; firstName: string | null; lastName: string | null }) {
  return { ...user, displayName: displayName(user) };
}

function xml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Small dependency-free XLSX writer using uncompressed ZIP entries and inline strings. */
export function xlsxWorkbook(rows: unknown[][]): Buffer {
  const col = (index: number) => {
    let out = ""; let n = index + 1;
    while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26); }
    return out;
  };
  const sheetRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, cellIndex) => {
    const ref = `${col(cellIndex)}${rowIndex + 1}`;
    const text = String(value ?? "");
    const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return typeof value === "number" && Number.isFinite(value) ? `<c r="${ref}"><v>${value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xml(safeText)}</t></is></c>`;
  }).join("")}</row>`).join("");
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="MIS Report" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`],
  ];
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const [name, body] of files) {
    const nameBytes = Buffer.from(name); const bodyBytes = Buffer.from(body); const checksum = crc32(bodyBytes);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt32LE(checksum, 14); header.writeUInt32LE(bodyBytes.length, 18); header.writeUInt32LE(bodyBytes.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, bodyBytes);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(checksum, 16); directory.writeUInt32LE(bodyBytes.length, 20); directory.writeUInt32LE(bodyBytes.length, 24); directory.writeUInt16LE(nameBytes.length, 28); directory.writeUInt32LE(offset, 42);
    central.push(directory, nameBytes); offset += header.length + nameBytes.length + bodyBytes.length;
  }
  const centralBytes = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}