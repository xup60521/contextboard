'use strict'

const pad = (value, width = 2) => String(value).padStart(width, '0')

const format_offset = offset_minutes => {
  const sign = offset_minutes < 0 ? '-' : '+'
  const absolute = Math.abs(offset_minutes)
  return `${sign}${pad(Math.floor(absolute / 60))}${pad(absolute % 60)}`
}

const format_local_timestamp = (date = new Date()) => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('cannot format an invalid local timestamp')
  const offset_minutes = -date.getTimezoneOffset()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${format_offset(offset_minutes)}`
}

const parse_numeric_timestamp = timestamp => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/u.exec(String(timestamp))
  if (match === null) return NaN
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offset_hour = Number(match[8])
  const offset_minute = Number(match[9])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 || offset_hour > 23 || offset_minute > 59) return NaN

  const wall = new Date(0)
  wall.setUTCFullYear(year, month - 1, day)
  wall.setUTCHours(hour, minute, second, 0)
  const offset_minutes = offset_hour * 60 + offset_minute
  const stamp_ms = wall.getTime() - (match[7] === '-' ? -offset_minutes : offset_minutes) * 60 * 1000
  if (!Number.isFinite(stamp_ms)) return NaN
  const projected = new Date(stamp_ms + (match[7] === '-' ? -offset_minutes : offset_minutes) * 60 * 1000)
  return projected.getUTCFullYear() === year &&
    projected.getUTCMonth() + 1 === month &&
    projected.getUTCDate() === day &&
    projected.getUTCHours() === hour &&
    projected.getUTCMinutes() === minute &&
    projected.getUTCSeconds() === second
    ? stamp_ms
    : NaN
}

module.exports = { format_local_timestamp, format_offset, parse_numeric_timestamp }
