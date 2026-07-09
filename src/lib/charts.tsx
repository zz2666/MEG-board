import type { MetricKey, QuarterPoint, Segment } from "./mock-data";

type LineChartProps = {
  points: QuarterPoint[];
  metric: MetricKey;
  accent?: string;
  onHoverPoint?: (point: { period: string; value: number; x: number; y: number } | null) => void;
};

type SegmentStackProps = {
  segments: Segment[];
};

const chartWidth = 720;
const chartHeight = 260;
const chartPadding = 34;

function getValue(point: QuarterPoint, metric: MetricKey) {
  return point[metric];
}

function formatValue(value: number, metric: MetricKey) {
  if (metric.includes("Margin") || metric === "expenseRatio") {
    return `${value.toFixed(1)}%`;
  }

  return `${value.toFixed(value < 0 ? 1 : 0)} 亿`;
}

export function TrendChart({
  points,
  metric,
  accent = "#1d4ed8",
  onHoverPoint,
}: LineChartProps) {
  const values = points.map((point) => getValue(point, metric));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerWidth = chartWidth - chartPadding * 2;
  const innerHeight = chartHeight - chartPadding * 2;

  const coords = values.map((value, index) => {
    const x = chartPadding + (index / Math.max(values.length - 1, 1)) * innerWidth;
    const y = chartPadding + (1 - (value - min) / span) * innerHeight;
    return { x, y, value, period: points[index].period };
  });

  const path = coords
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const areaPath = `${path} L ${coords.at(-1)?.x ?? chartPadding} ${chartHeight - chartPadding} L ${chartPadding} ${chartHeight - chartPadding} Z`;

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="财务趋势图">
        <defs>
          <linearGradient id={`area-${metric}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.24" />
            <stop offset="100%" stopColor={accent} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => {
          const y = chartPadding + (line / 3) * innerHeight;
          return (
            <line
              key={line}
              x1={chartPadding}
              x2={chartWidth - chartPadding}
              y1={y}
              y2={y}
              className="chart-grid"
            />
          );
        })}
        <path d={areaPath} fill={`url(#area-${metric})`} />
        <path d={path} className="trend-line" style={{ stroke: accent }} />
        {coords.map((point) => (
          <g
            key={point.period}
            className="trend-hotspot"
            onMouseEnter={() => onHoverPoint?.(point)}
            onMouseLeave={() => onHoverPoint?.(null)}
            onFocus={() => onHoverPoint?.(point)}
            onBlur={() => onHoverPoint?.(null)}
            tabIndex={0}
          >
            <line
              x1={point.x}
              x2={point.x}
              y1={chartPadding}
              y2={chartHeight - chartPadding}
              className="trend-hover-line"
            />
            <circle cx={point.x} cy={point.y} r="4.5" className="trend-dot" style={{ fill: accent }} />
            <circle cx={point.x} cy={point.y} r="15" className="trend-target" />
            <text x={point.x} y={chartHeight - 11} textAnchor="middle" className="chart-label">
              {point.period}
            </text>
          </g>
        ))}
        <text x={chartPadding} y={18} className="chart-value">
          {formatValue(max, metric)}
        </text>
        <text x={chartPadding} y={chartHeight - chartPadding + 3} className="chart-value">
          {formatValue(min, metric)}
        </text>
      </svg>
    </div>
  );
}

export function SegmentStackChart({ segments }: SegmentStackProps) {
  const max = Math.max(...segments.flatMap((segment) => segment.trend));
  const periods = segments[0]?.trend.map((_, index) => index) ?? [];
  const barWidth = 44;
  const gap = 28;
  const baseY = 220;
  const scale = 150 / max;

  return (
    <div className="chart-shell compact">
      <svg viewBox="0 0 620 250" role="img" aria-label="业务分部堆叠柱状图">
        {[0, 1, 2].map((line) => (
          <line
            key={line}
            x1="24"
            x2="596"
            y1={baseY - line * 60}
            y2={baseY - line * 60}
            className="chart-grid"
          />
        ))}
        {periods.map((periodIndex) => {
          let offset = 0;
          const x = 42 + periodIndex * (barWidth + gap);

          return (
            <g key={periodIndex}>
              {segments.map((segment) => {
                const height = segment.trend[periodIndex] * scale;
                const y = baseY - offset - height;
                offset += height;
                return (
                  <rect
                    key={`${segment.name}-${periodIndex}`}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={Math.max(height, 2)}
                    rx="4"
                    fill={segment.color}
                    opacity="0.9"
                  />
                );
              })}
              <text x={x + barWidth / 2} y="241" textAnchor="middle" className="chart-label">
                Q{periodIndex + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = 4 + (index / Math.max(values.length - 1, 1)) * 112;
    const y = 28 - ((value - min) / span) * 24;
    return { x, y };
  });
  const path = coords
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <svg viewBox="0 0 120 36" className="sparkline" aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
