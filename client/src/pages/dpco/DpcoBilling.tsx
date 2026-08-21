import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import {
  PlusCircle,
  FileText,
  DollarSign,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  Clock,
  CreditCard,
  FileDown,
  Mail,
  ExternalLink,
} from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";

// Demo DPCO org ID — in production this comes from auth context
const DEMO_DPCO_ORG_ID = 1;

function formatNGN(amount: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    draft: "bg-muted text-foreground",
    sent: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    paid: "bg-green-500/15 text-green-600 dark:text-green-400",
    overdue: "bg-red-500/15 text-red-600 dark:text-red-400",
    cancelled: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── Create Invoice Dialog ────────────────────────────────────────────────────
function CreateInvoiceDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    clientName: "",
    clientEmail: "",
    serviceType: "compliance_audit",
    description: "",
    subtotal: "",
    dueDate: "",
    notes: "",
  });

  const createMutation = trpc.billing.createInvoice.useMutation({
    onSuccess: () => {
      toast.success("Invoice created");
      setOpen(false);
      onCreated();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const subtotal = parseFloat(form.subtotal);
    if (!subtotal || subtotal <= 0) {
      toast.error("Enter a valid subtotal");
      return;
    }
    createMutation.mutate({
      dpcoOrgId: DEMO_DPCO_ORG_ID,
      clientName: form.clientName,
      clientEmail: form.clientEmail || undefined,
      serviceType: form.serviceType,
      description: form.description || undefined,
      subtotal,
      vatRate: 0.075,
      dueDate: form.dueDate,
      notes: form.notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <PlusCircle className="h-4 w-4" />
          New Invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Invoice</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Client Name *</Label>
              <Input
                required
                value={form.clientName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, clientName: e.target.value }))
                }
                placeholder="Acme Corp Ltd"
              />
            </div>
            <div>
              <Label>Client Email</Label>
              <Input
                type="email"
                value={form.clientEmail}
                onChange={(e) =>
                  setForm((f) => ({ ...f, clientEmail: e.target.value }))
                }
                placeholder="billing@acme.ng"
              />
            </div>
            <div>
              <Label>Service Type *</Label>
              <Select
                value={form.serviceType}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, serviceType: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="compliance_audit">
                    Compliance Audit
                  </SelectItem>
                  <SelectItem value="dpia_assessment">
                    DPIA Assessment
                  </SelectItem>
                  <SelectItem value="training_session">
                    Training Session
                  </SelectItem>
                  <SelectItem value="policy_drafting">
                    Policy Drafting
                  </SelectItem>
                  <SelectItem value="retainer_monthly">
                    Monthly Retainer
                  </SelectItem>
                  <SelectItem value="breach_response">
                    Breach Response
                  </SelectItem>
                  <SelectItem value="dpo_as_service">DPO as a Service</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Subtotal (NGN) *</Label>
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.subtotal}
                onChange={(e) =>
                  setForm((f) => ({ ...f, subtotal: e.target.value }))
                }
                placeholder="500000"
              />
            </div>
            <div>
              <Label>Due Date *</Label>
              <Input
                required
                type="date"
                value={form.dueDate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, dueDate: e.target.value }))
                }
              />
            </div>
            <div className="col-span-2">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Scope of services..."
              />
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Payment terms, bank details..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating..." : "Create Invoice"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Record Payment Dialog ────────────────────────────────────────────────────
function RecordPaymentDialog({
  invoiceId,
  invoiceTotal,
  onPaid,
}: {
  invoiceId: number;
  invoiceTotal: number;
  onPaid: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    amount: String(invoiceTotal),
    paymentMethod: "bank_transfer",
    gatewayReference: "",
    notes: "",
  });

  const payMutation = trpc.billing.recordPayment.useMutation({
    onSuccess: (data) => {
      toast.success(`Payment recorded — Net to DPCO: ${formatNGN(data.dpcoNetAmount)}`);
      setOpen(false);
      onPaid();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <CreditCard className="h-3.5 w-3.5" />
          Record Payment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            payMutation.mutate({
              invoiceId,
              amount: parseFloat(form.amount),
              paymentMethod: form.paymentMethod as any,
              gatewayReference: form.gatewayReference || undefined,
              notes: form.notes || undefined,
            });
          }}
          className="space-y-4 mt-2"
        >
          <div>
            <Label>Amount (NGN)</Label>
            <Input
              type="number"
              value={form.amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, amount: e.target.value }))
              }
            />
          </div>
          <div>
            <Label>Payment Method</Label>
            <Select
              value={form.paymentMethod}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, paymentMethod: v }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="ussd">USSD</SelectItem>
                <SelectItem value="mobile_money">Mobile Money</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Reference / Transaction ID</Label>
            <Input
              value={form.gatewayReference}
              onChange={(e) =>
                setForm((f) => ({ ...f, gatewayReference: e.target.value }))
              }
              placeholder="TXN-..."
            />
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              rows={2}
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={payMutation.isPending}>
              {payMutation.isPending ? "Processing..." : "Confirm Payment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
// ─── Send Invoice Email Dialog ──────────────────────────────────────────────────────
function SendInvoiceEmailDialog({
  invoiceId,
  defaultEmail,
  invoiceNumber,
  onSent,
}: {
  invoiceId: number;
  defaultEmail?: string;
  invoiceNumber: string;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [message, setMessage] = useState("");

  const sendMutation = trpc.billing.sendInvoiceEmail.useMutation({
    onSuccess: (data) => {
      toast.success(`Invoice ${data.invoiceNumber} sent to ${data.sentTo}`);
      setOpen(false);
      onSent();
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" title="Send invoice by email">
          <Mail className="h-3.5 w-3.5" />
          Send
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send Invoice {invoiceNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label>Recipient Email *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
            />
          </div>
          <div>
            <Label>Optional Message</Label>
            <Textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Please find attached your invoice..."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A PDF copy of the invoice will be generated and attached. The invoice status will be
            updated to <strong>Sent</strong> if currently in Draft.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={sendMutation.isPending || !email.includes("@")}
              onClick={() =>
                sendMutation.mutate({
                  invoiceId,
                  recipientEmail: email || undefined,
                  message: message || undefined,
                })
              }
            >
              {sendMutation.isPending ? "Sending..." : "Send Invoice"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stripe Pay Button ──────────────────────────────────────────────────────────────────
function StripePayButton({ invoiceId, onPaid }: { invoiceId: number; onPaid: () => void }) {
  const checkoutMutation = trpc.billing.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      toast.info("Redirecting to Stripe Checkout...");
      window.open(data.url, "_blank");
    },
    onError: (e) => toast.error((e instanceof Error ? e.message : String(e))),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      className="h-7 text-xs gap-1 border-violet-400 text-violet-600 hover:bg-violet-50"
      title="Pay via Stripe"
      disabled={checkoutMutation.isPending}
      onClick={() =>
        checkoutMutation.mutate({
          invoiceId,
          origin: window.location.origin,
        })
      }
    >
      <ExternalLink className="h-3.5 w-3.5" />
      {checkoutMutation.isPending ? "..." : "Pay Online"}
    </Button>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────
export default function DpcoBilling() {  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "12m">("30d");
  const utils = trpc.useUtils();

  const invoicesQuery = trpc.billing.listInvoices.useQuery({
    dpcoOrgId: DEMO_DPCO_ORG_ID,
    limit: 100,
  });

  const earningsQuery = trpc.billing.getDpcoEarnings.useQuery({
    dpcoOrgId: DEMO_DPCO_ORG_ID,
    period,
  });

  const subQuery = trpc.billing.getSubscription.useQuery({
    dpcoOrgId: DEMO_DPCO_ORG_ID,
  });

  const refresh = () => {
    utils.billing.listInvoices.invalidate();
    utils.billing.getDpcoEarnings.invalidate();
  };

  const invoices = invoicesQuery.data?.rows ?? [];
  const earnings = earningsQuery.data;
  const sub = subQuery.data;

  const updateStatus = trpc.billing.updateInvoiceStatus.useMutation({
    onSuccess: () => refresh(),
  });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs items={[{ label: "DPCO Portal", href: "/dpco" }, { label: "Billing" }]} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Billing & Earnings
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage invoices, record payments, and track your DPCO earnings
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as typeof period)}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="12m">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
          <CreateInvoiceDialog onCreated={refresh} />
        </div>
      </div>

      {/* Subscription Banner */}
      {sub && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm">
          <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
          <span>
            <strong>{sub.tier?.charAt(0).toUpperCase() + sub.tier?.slice(1)}</strong>{" "}
            plan · Platform fee:{" "}
            <strong>{(Number(sub.platform_fee_rate) * 100).toFixed(0)}%</strong>{" "}
            · Max clients: <strong>{sub.max_clients}</strong>
          </span>
          <span className="ml-auto">
            <Badge
              variant={sub.status === "active" ? "default" : "secondary"}
            >
              {sub.status}
            </Badge>
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Billed",
            value: formatNGN(earnings?.summary.totalBilled ?? 0),
            icon: DollarSign,
            color: "text-blue-600",
            bg: "bg-blue-50",
          },
          {
            label: "Net Earned",
            value: formatNGN(earnings?.summary.totalEarned ?? 0),
            icon: TrendingUp,
            color: "text-green-600",
            bg: "bg-green-50",
          },
          {
            label: "Outstanding",
            value: formatNGN(earnings?.summary.outstandingAmount ?? 0),
            icon: Clock,
            color: "text-amber-600",
            bg: "bg-amber-50",
          },
          {
            label: "Overdue Invoices",
            value: String(earnings?.summary.overdueInvoices ?? 0),
            icon: AlertCircle,
            color: "text-red-600",
            bg: "bg-red-50",
          },
        ].map((kpi) => (
          <Card key={kpi.label} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${kpi.bg}`}>
                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-lg font-bold">{kpi.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">
            <FileText className="h-4 w-4 mr-1.5" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="earnings">
            <TrendingUp className="h-4 w-4 mr-1.5" />
            Earnings Analytics
          </TabsTrigger>
        </TabsList>

        {/* ── Invoices Tab ── */}
        <TabsContent value="invoices" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Invoice Register</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {invoicesQuery.isLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  Loading invoices...
                </div>
              ) : invoices.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No invoices yet. Create your first invoice above.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Net to You</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv: any) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-mono text-xs">
                          {inv.invoice_number}
                        </TableCell>
                        <TableCell className="font-medium">
                          {inv.client_name}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground capitalize">
                          {inv.service_type?.replace(/_/g, " ")}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatNGN(Number(inv.total_amount))}
                        </TableCell>
                        <TableCell className="text-right text-green-700 font-medium">
                          {formatNGN(Number(inv.dpco_net_amount))}
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(inv.due_date).toLocaleDateString("en-NG")}
                        </TableCell>
                        <TableCell>{statusBadge(inv.status)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs gap-1"
                              title="Download PDF"
                              onClick={() => window.open(`/api/invoices/${inv.id}/invoice.pdf`, "_blank")}
                            >
                              <FileDown className="h-3.5 w-3.5" />
                              PDF
                            </Button>
                            {inv.status === "draft" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() =>
                                  updateStatus.mutate({
                                    id: inv.id,
                                    status: "sent",
                                  })
                                }
                              >
                                Mark Sent
                              </Button>
                            )}
                            <SendInvoiceEmailDialog
                              invoiceId={inv.id}
                              defaultEmail={inv.client_email ?? ""}
                              invoiceNumber={inv.invoice_number}
                              onSent={refresh}
                            />
                            {(inv.status === "sent" ||
                              inv.status === "overdue") && (
                              <>
                                <RecordPaymentDialog
                                  invoiceId={inv.id}
                                  invoiceTotal={Number(inv.total_amount)}
                                  onPaid={refresh}
                                />
                                <StripePayButton
                                  invoiceId={inv.id}
                                  onPaid={refresh}
                                />
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Earnings Analytics Tab ── */}
        <TabsContent value="earnings" className="mt-4 space-y-4">
          {/* Monthly Revenue Trend */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Monthly Revenue Trend (12 months)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(earnings?.monthlyTrend?.length ?? 0) === 0 ? (
                <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                  No payment data yet
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={earnings!.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) =>
                        `₦${(v / 1000).toFixed(0)}k`
                      }
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                    />
                    <Tooltip
                      formatter={(v: number) => formatNGN(v)}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Bar
                      dataKey="total_billed"
                      name="Billed"
                      fill="#93c5fd"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="net_earned"
                      name="Net Earned"
                      fill="#4ade80"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Revenue by Service Type */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">By Service Type</CardTitle>
              </CardHeader>
              <CardContent>
                {(earnings?.byServiceType?.length ?? 0) === 0 ? (
                  <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                    No data yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {earnings!.byServiceType.map((svc: any) => (
                      <div key={svc.service_type} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="capitalize">
                            {svc.service_type?.replace(/_/g, " ")}
                          </span>
                          <span className="font-medium text-green-700">
                            {formatNGN(Number(svc.net_earned))}
                          </span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{
                              width: `${Math.min(100, (Number(svc.net_earned) / (earnings!.summary.totalEarned || 1)) * 100)}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Recent Payments */}
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recent Payments</CardTitle>
              </CardHeader>
              <CardContent>
                {(earnings?.recentPayments?.length ?? 0) === 0 ? (
                  <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                    No payments yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {earnings!.recentPayments.map((pay: any) => (
                      <div
                        key={pay.id}
                        className="flex items-center justify-between py-1.5 border-b last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {pay.client_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {pay.service_type?.replace(/_/g, " ")} ·{" "}
                            {new Date(pay.paid_at).toLocaleDateString("en-NG")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-green-700">
                            {formatNGN(Number(pay.dpco_net_amount))}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            net
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
