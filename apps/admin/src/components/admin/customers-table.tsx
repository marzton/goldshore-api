import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "@/components/admin/data-table";

import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

export type Customer = {
  id: number;
  name: string;
  email: string;
  notes: string;
  created_at: string;
  updated_at: string;
  subscription?: {
    id: number;
    status: string;
    name: string;
    description: string;
    price: number;
    ends_at: number | null;
  };
};

const columnHelper = createColumnHelper<Customer>();

const columns: ColumnDef<Customer>[] = [
  columnHelper.accessor("id", {
    header: "ID",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("name", {
    header: "Name",
    cell: (info) => {
      return (
        <a
          className="text-primary underline"
          href={`/admin/customers/${info.row.original.id}`}
        >
          {info.getValue()}
        </a>
      );
    },
  }),
  columnHelper.accessor("email", {
    header: "Email",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("notes", {
    header: "Notes",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("subscription.status", {
    header: "Subscription",
    cell: (info) => info.getValue(),
  columnHelper.accessor((row) => row.subscription?.status ?? null, {
    id: "subscription.status",
    header: "Subscription",
    cell: (info) => {
      const subscription = info.row.original.subscription;

      if (!subscription) {
        return "—";
      }

      if (subscription.status === "expired" && subscription.ends_at) {
        return `${subscription.status} (${new Date(subscription.ends_at).toLocaleDateString()})`;
      }

      return subscription.status;
    },
  }),
  columnHelper.accessor("created_at", {
    header: "Created At",
    cell: (info) => new Date(info.getValue()).toLocaleDateString(),
  }),
  columnHelper.accessor("updated_at", {
    header: "Updated At",
    cell: (info) => new Date(info.getValue()).toLocaleDateString(),
  }),
];

interface DataTableProps {
  data: Customer[];
}

export function CustomersTable({ data }: DataTableProps) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="rounded-md border">
      <DataTable table={table} />
    </div>
  );
}
