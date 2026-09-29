import type { FeatureRoute } from "../../app/route-types";
import { FeatureStub } from "../../app/stub-screen";
import { EmptyState, Button } from "../../ui";

export const customersRoutes: FeatureRoute[] = [
  {
    path: "khach-hang",
    requiredPermissions: ["contract:read"],
    element: (
      <FeatureStub title="Khách hàng" description="Danh sách đối tác và thông tin liên hệ dùng chung cho các hợp đồng.">
        <EmptyState title="Chưa có khách nào — thêm khách đầu tiên để bắt đầu." action={<Button disabled>+ Thêm khách</Button>} />
      </FeatureStub>
    ),
  },
];
