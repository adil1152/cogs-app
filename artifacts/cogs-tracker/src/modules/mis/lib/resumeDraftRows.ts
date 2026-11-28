import type { MisEntry, MisParentDetail, MisService } from "@workspace/api-client-react";

export function isUnfinishedDraftRow(item: Pick<MisEntry, "id">) {
  return item.id.startsWith("unfinished:");
}

/** Saved snapshots always win; missing services are form rows, not database entries. */
export function resumeDraftRows(detail: MisParentDetail, services: MisService[]): MisEntry[] {
  const savedServices = new Set(detail.items.map((item) => item.serviceId));
  const missing: MisEntry[] = services.filter((service) => !savedServices.has(service.id)).map((service) => ({
    id: `unfinished:${service.id}`,
    parentId: detail.parent.id,
    bulkNumber: detail.parent.bulkNumber,
    projectId: detail.parent.projectId,
    tabId: service.tabId,
    serviceId: service.id,
    fromDate: detail.parent.fromDate,
    toDate: detail.parent.toDate,
    quantity: null,
    rate: service.defaultRate,
    amount: 0,
    calculationMode: service.calculationMode,
    rateEnabled: service.rateEnabled,
    calculatePercentAgainstIncome: service.calculatePercentAgainstIncome,
    projectName: detail.parent.projectName,
    tabName: service.tabName,
    serviceName: service.name,
    type: service.tabType,
    financialClass: service.financialClass,
    unit: service.unit,
    currency: service.currency,
    status: "draft",
    remarks: null,
    createdById: detail.parent.createdById,
    createdAt: detail.parent.createdAt,
    updatedAt: detail.parent.updatedAt,
  }));
  const rank = new Map(["income", "cost", "expense", "salary", "other"].map((type, index) => [type, index]));
  const order = new Map(services.map((service, index) => [service.id, index]));
  return [...detail.items, ...missing].sort((a, b) =>
    (rank.get(a.type) ?? 4) - (rank.get(b.type) ?? 4)
    || (order.get(a.serviceId) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.serviceId) ?? Number.MAX_SAFE_INTEGER),
  );
}
