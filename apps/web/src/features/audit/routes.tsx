import type { FeatureRoute } from "../../app/route-types";
import { FeatureStub } from "../../app/stub-screen";
import { EmptyState } from "../../ui";

export const auditRoutes: FeatureRoute[] = [
  {
    path: "nhat-ky",
    requiredPermissions: ["audit:read"],
    element: <FeatureStub title="Nhật ký" description="Mọi thay đổi quan trọng đều được ghi lại kèm người thực hiện và thời gian."><EmptyState title="Nhật ký sẽ hiển thị khi API /audit sẵn sàng." /></FeatureStub>,
  },
];
