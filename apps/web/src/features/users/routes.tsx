import type { FeatureRoute } from "../../app/route-types";
import { FeatureStub } from "../../app/stub-screen";
import { EmptyState } from "../../ui";

export const usersRoutes: FeatureRoute[] = [
  {
    path: "nguoi-dung",
    requiredPermissions: ["users:read"],
    element: <FeatureStub title="Người dùng" description="Tài khoản, vai trò và trạng thái của đội ngũ nội bộ."><EmptyState title="Danh sách người dùng sẽ hiển thị khi API /admin/users sẵn sàng." /></FeatureStub>,
  },
];
