"use client";

import { useId, useMemo } from "react";
import styles from "./date-time-select.module.css";

interface DateTimeSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  helperText?: string;
  minValue?: string;
}

const MINUTES_PER_STEP = 15;
const DATE_WINDOW_DAYS = 365;

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitValue(value: string) {
  const normalized = value.trim().replace(" ", "T");
  const [date = "", rawTime = ""] = normalized.split("T");
  return { date, time: rawTime.slice(0, 5) };
}

function localDateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function DateTimeSelect({ label, value, onChange, optional = false, helperText, minValue }: DateTimeSelectProps) {
  const id = useId();
  const selected = splitValue(value);
  const minimum = splitValue(minValue ?? "").date;

  const dates = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = minimum && localDateFromKey(minimum) > today ? localDateFromKey(minimum) : today;
    const formatter = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const options = Array.from({ length: DATE_WINDOW_DAYS + 1 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return { value: dateKey(date), label: formatter.format(date) };
    });
    if (selected.date && !options.some((option) => option.value === selected.date)) {
      options.unshift({ value: selected.date, label: formatter.format(localDateFromKey(selected.date)) });
    }
    return options;
  }, [minimum, selected.date]);

  const times = useMemo(() => Array.from({ length: (24 * 60) / MINUTES_PER_STEP }, (_, index) => {
    const totalMinutes = index * MINUTES_PER_STEP;
    const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minutes = String(totalMinutes % 60).padStart(2, "0");
    return `${hours}:${minutes}`;
  }), []);

  function chooseDate(nextDate: string) {
    if (!nextDate) {
      onChange("");
      return;
    }
    onChange(`${nextDate}T${selected.time || "09:00"}`);
  }

  function chooseTime(nextTime: string) {
    if (selected.date && nextTime) onChange(`${selected.date}T${nextTime}`);
  }

  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.controls}>
        <select id={`${id}-date`} aria-label={`${label} date`} value={selected.date} onChange={(event) => chooseDate(event.target.value)}>
          <option value="">{optional ? "No deadline" : "Select date"}</option>
          {dates.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <select id={`${id}-time`} aria-label={`${label} time`} value={selected.time || "09:00"} onChange={(event) => chooseTime(event.target.value)} disabled={!selected.date}>
          {times.map((time) => <option key={time} value={time}>{time}</option>)}
        </select>
      </div>
      {helperText ? <small>{helperText}</small> : null}
    </div>
  );
}
