import { useMemo } from "react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

interface SparklineWidgetProps {
  orgId?: string;
  sector?: string;
  days?: number;
  className?: string;
  showLabel?: boolean;
  height?: number;
}

interface SparklineDataProps {
  data: Array<{ score: number; recorded_at: string; sector?: string }>;
  height?: number;
  className?: string;
  showLabel?: boolean;
}

function SparklineChart({ data, height = 80, className, showLabel = true }: SparklineDataProps) {
  const trend = useMemo(() => {
    if (data.length < 2) return "flat";
    const first = Number(data[0]?.score ?? 0);
    const last = Number(data[data.length - 1]?.score ?? 0);
    const diff = last - first;
    if (diff > 2) return "up";
    if (diff < -2) return "down";
    return "flat";
  }, [data]);

  const latestScore = data.length > 0 ? Number(data[data.length - 1]?.score ?? 0) : 0;

  const trendColor =
    trend === "up" ? "#22c55e" : trend === "down" ? "#ef4444" : "#94a3b8";

  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  const chartData = data.map((d) => ({
    score: Number(d.score),
    date: d.recorded_at,
  }));

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {showLabel && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Compliance Trend</span>
          <div className="flex items-center gap-1">
            <TrendIcon className="h-3 w-3" style={{ color: trendColor }} />
            <span className="text-xs font-semibold" style={{ color: trendColor }}>
              {latestScore.toFixed(1)}%
            </span>
          </div>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <ReferenceLine y={70} stroke="#94a3b8" strokeDasharray="3 3" strokeOpacity={0.4} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "6px",
              fontSize: "11px",
              padding: "4px 8px",
            }}
            formatter={(value: number) => [`${Number(value).toFixed(1)}%`, "Score"]}
            labelFormatter={(label: string) =>
              label ? new Date(label).toLocaleDateString() : ""
            }
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke={trendColor}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: trendColor }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SparklineWidget({
  orgId,
  sector,
  days = 30,
  className,
  showLabel = true,
  height = 80,
}: SparklineWidgetProps) {
  const { data, isLoading } = trpc.sparkline.getHistory.useQuery(
    { orgId, sector, days },
    { staleTime: 5 * 60 * 1000 }
  );

  if (isLoading) {
    return (
      <div
        className={cn(
          "animate-pulse bg-muted rounded",
          className
        )}
        style={{ height }}
      />
    );
  }

  if (!data || data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center text-xs text-muted-foreground",
          className
        )}
        style={{ height }}
      >
        No data
      </div>
    );
  }

  return (
    <SparklineChart
      data={data}
      height={height}
      className={className}
      showLabel={showLabel}
    />
  );
}

// Standalone chart component for use with pre-fetched data
export { SparklineChart };
