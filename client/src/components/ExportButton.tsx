import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";

interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename?: string;
  label?: string;
  disabled?: boolean;
}

function toCSV(data: Record<string, unknown>[]): string {
  if (!data.length) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map((row) =>
    headers
      .map((h) => {
        const val = row[h];
        const str = val === null || val === undefined ? "" : String(val);
        return `"${str.replace(/"/g, '""')}"`;
      })
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButton({
  data,
  filename = "export",
  label = "Export",
  disabled = false,
}: ExportButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleCSV = () => {
    if (!data.length) {
      toast.error("No data to export");
      return;
    }
    setLoading(true);
    try {
      const csv = toCSV(data);
      downloadBlob(csv, `${filename}.csv`, "text/csv;charset=utf-8;");
      toast.success(`Exported ${data.length} rows as CSV`);
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setLoading(false);
    }
  };

  const handleExcel = async () => {
    if (!data.length) {
      toast.error("No data to export");
      return;
    }
    setLoading(true);
    try {
      
      
      
      
      const { exportToCsv } = await import("@/lib/safeExport"); exportToCsv(data as Record<string, unknown>[], filename);
      toast.success(`Exported ${data.length} rows as Excel`);
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || loading}>
          <Download className="h-4 w-4 mr-2" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCSV}>
          <FileText className="h-4 w-4 mr-2" />
          Export as CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExcel}>
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Export as Excel (.xlsx)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
