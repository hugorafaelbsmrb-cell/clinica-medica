"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export type AttendanceChartPoint = {
  day: string
  total: number
}

export function AttendancesChart({
  data,
}: {
  data: AttendanceChartPoint[]
}) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            className="text-xs"
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            className="text-xs"
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            formatter={(value) => [`${value} atendimento(s)`, "Total"]}
            contentStyle={{
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "var(--popover)",
            }}
          />
          <Bar dataKey="total" fill="var(--primary)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
