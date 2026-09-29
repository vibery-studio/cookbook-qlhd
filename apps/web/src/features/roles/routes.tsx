import type { FeatureRoute } from "../../app/route-types";
import { FeatureStub } from "../../app/stub-screen";
import { EmptyState } from "../../ui";

export const rolesRoutes: FeatureRoute[] = [
  {
    path: "phan-quyen",
    element: <FeatureStub title="Phân quyền" description="Ma trận quyền theo vai trò của đội ngũ nội bộ."><EmptyState title="Ma trận quyền sẽ hiển thị khi API /roles sẵn sàng." /></FeatureStub>,
  },
];
