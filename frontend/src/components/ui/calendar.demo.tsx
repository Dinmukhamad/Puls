"use client";

import * as React from "react";
import { Calendar } from "@/components/ui/calendar";

const today = new Date();

export function CalendarPreview() {
  const [selected, setSelected] = React.useState<Date | undefined>(today);
  return <Calendar selected={selected} onSelect={setSelected} />;
}

export default function Demo() {
  return <CalendarPreview />;
}
