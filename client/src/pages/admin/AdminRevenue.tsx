import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Users,
  BarChart2,
  CheckCircle2,
  Clock,
  ArrowUpRight,
} from "lucide-react";

function formatNGN(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

const CHART_COLORS = [
  "#6366f1",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#06b6d4",
];

export default function AdminRevenue() {
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "12m">("30d");
  const [selectedSplits, setSelectedSplits] = useState<number[]>([]);
  const utils = trpc.useUtils();

  const revenueQuery = trpc.billing.getPlatformRevenue.useQuery({ period });
  const splitsQuery = trpc.billing.listRevenueSplits.useQuery({
    dpcoPaidOut: false,
    limit: 100,
  });

  const markPaidMutation = trpc.billing.markDpcoPaidOut.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.count} split(s) marked as paid out to DPCO.`);
      setSelectedSplits([]);
      utils.billing.listRevenueSplits.invalidate();
      utils.billing.getPlatformRevenue.invalidate();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const revenue = revenueQuery.data;
  const splits = splitsQuery.data?.rows ?? [];

  const toggleSplit = (id: number) => {
    setSelectedSplits((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAll = () => {
    if (selectedSplits.length === splits.length) {
      setSelectedSplits([]);
    } else {
      setSelectedSplits(splits.map((s: any) => s.id));
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Platform Revenue
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Revenue splits, DPCO earnings, and payout ledger
          </p>
        </div>
        <Select
          value={period}
          onValueChange={(v) => setPeriod(v as typeof period)}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="12m">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Gross Revenue",
            value: formatNGN(revenue?.summary.grossRevenue ?? 0),
            icon: DollarSign,
            color: "text-blue-600",
            bg: "bg-blue-50",
            sub: "Total payments processed",
          },
          {
            label: "Platform Revenue",
            value: formatNGN(revenue?.summary.platformRevenue ?? 0),
            icon: TrendingUp,
            color: "text-green-600",
            bg: "bg-green-50",
            sub: `Avg fee: ${((revenue?.summary.avgFeeRate ?? 0) * 100).toFixed(1)}%`,
          },
          {
            label: "DPCO Payouts",
            value: formatNGN(revenue?.summary.dpcoPayouts ?? 0),
            icon: ArrowUpRight,
            color: "text-purple-600",
            bg: "bg-purple-50",
            sub: "Net to DPCOs",
          },
          {
            label: "Active DPCOs",
            value: String(revenue?.summary.activeDpcos ?? 0),
            icon: Users,
            color: "text-amber-600",
            bg: "bg-amber-50",
            sub: `${revenue?.summary.totalPayments ?? 0} transactions`,
          },
        ].map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className={`p-2 rounded-lg ${kpi.bg} mt-0.5`}>
                  <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <p className="text-xl font-bold">{kpi.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {kpi.sub}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">
            <BarChart2 className="h-4 w-4 mr-1.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="by-dpco">
            <Users className="h-4 w-4 mr-1.5" />
            By DPCO
          </TabsTrigger>
          <TabsTrigger value="payouts">
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            Pending Payouts
            {splits.length > 0 && (
              <Badge className="ml-1.5 h-4 px-1 text-[10px]">
                {splits.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Monthly Revenue Trend (12 months)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(revenue?.monthlyTrend?.length ?? 0) === 0 ? (
                <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
                  No revenue data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={revenue!.monthlyTrend}>
                    <defs>
                      <linearGradient
                        id="grossGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#6366f1"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#6366f1"
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="platGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#22c55e"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#22c55e"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v: number) => formatNGN(v)}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="gross_revenue"
                      name="Gross Revenue"
                      stroke="#6366f1"
                      fill="url(#grossGrad)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="platform_revenue"
                      name="Platform Revenue"
                      stroke="#22c55e"
                      fill="url(#platGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Revenue Split Pie */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Revenue Split</CardTitle>
              </CardHeader>
              <CardContent>
                {!revenue?.summary.grossRevenue ? (
                  <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                    No data
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={[
                          {
                            name: "Platform",
                            value: revenue.summary.platformRevenue,
                          },
                          {
                            name: "DPCO Payouts",
                            value: revenue.summary.dpcoPayouts,
                          },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, percent }) =>
                          `${name} ${(percent * 100).toFixed(0)}%`
                        }
                        labelLine={false}
                      >
                        <Cell fill="#6366f1" />
                        <Cell fill="#22c55e" />
                      </Pie>
                      <Tooltip formatter={(v: number) => formatNGN(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Pending Payouts Summary */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  Pending DPCO Payouts
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(revenue?.pendingPayouts?.length ?? 0) === 0 ? (
                  <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
                    All payouts settled
                  </div>
                ) : (
                  <div className="space-y-2">
                    {revenue!.pendingPayouts.slice(0, 6).map((p: any) => (
                      <div
                        key={p.dpco_org_id}
                        className="flex items-center justify-between py-1.5 border-b last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium">{p.dpco_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.pending_count} transaction
                            {p.pending_count !== 1 ? "s" : ""}
                          </p>
                        </div>
                        <span className="text-sm font-bold text-amber-600">
                          {formatNGN(Number(p.pending_payout_amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── By DPCO Tab ── */}
        <TabsContent value="by-dpco" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Revenue by DPCO</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {(revenue?.byDpco?.length ?? 0) === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No DPCO revenue data yet
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>DPCO</TableHead>
                      <TableHead>Licence</TableHead>
                      <TableHead className="text-right">Transactions</TableHead>
                      <TableHead className="text-right">Gross Revenue</TableHead>
                      <TableHead className="text-right">Platform Share</TableHead>
                      <TableHead className="text-right">DPCO Payout</TableHead>
                      <TableHead className="text-right">Fee Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {revenue!.byDpco.map((d: any) => (
                      <TableRow key={d.dpco_org_id}>
                        <TableCell className="font-medium">
                          {d.dpco_name ?? `DPCO #${d.dpco_org_id}`}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {d.licence_number ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {d.transactions}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatNGN(Number(d.gross_revenue))}
                        </TableCell>
                        <TableCell className="text-right text-indigo-700 font-medium">
                          {formatNGN(Number(d.platform_revenue))}
                        </TableCell>
                        <TableCell className="text-right text-green-700 font-medium">
                          {formatNGN(Number(d.dpco_payouts))}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {(Number(d.fee_rate) * 100).toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Pending Payouts Tab ── */}
        <TabsContent value="payouts" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Pending DPCO Payouts
              </CardTitle>
              {selectedSplits.length > 0 && (
                <Button
                  size="sm"
                  onClick={() =>
                    markPaidMutation.mutate({ splitIds: selectedSplits })
                  }
                  disabled={markPaidMutation.isPending}
                  className="gap-1.5"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Mark {selectedSplits.length} as Paid Out
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {splits.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  All DPCO payouts are settled
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={selectedSplits.length === splits.length && splits.length > 0}
                          onCheckedChange={toggleAll}
                        />
                      </TableHead>
                      <TableHead>DPCO</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Platform</TableHead>
                      <TableHead className="text-right">DPCO Payout</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {splits.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedSplits.includes(s.id)}
                            onCheckedChange={() => toggleSplit(s.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          {s.dpco_name ?? `DPCO #${s.dpco_org_id}`}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {s.invoice_number}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.client_name}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatNGN(Number(s.total_amount))}
                        </TableCell>
                        <TableCell className="text-right text-indigo-700">
                          {formatNGN(Number(s.platform_share))}
                        </TableCell>
                        <TableCell className="text-right text-green-700 font-bold">
                          {formatNGN(Number(s.dpco_share))}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(s.split_at).toLocaleDateString("en-NG")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
