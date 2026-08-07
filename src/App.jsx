import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Upload, Trash2, Plus, Copy, Check, Loader2, Moon, Sun, Sunset, X, CalendarPlus, Download } from 'lucide-react';

const PRAYER_ORDER = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const PRAYER_LABELS = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
const PRAYER_ICONS = { fajr: Moon, dhuhr: Sun, asr: Sun, maghrib: Sunset, isha: Moon };

function parseTimeToMinutes(t) {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3] ? m[3].toUpperCase() : null;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(iso) {
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

// Normalize a prayer cell to {start, jamaat}. Accepts legacy plain-string values too.
function normalizeCell(v) {
  if (v && typeof v === 'object') return { start: v.start || '', jamaat: v.jamaat || '' };
  if (typeof v === 'string') return { start: v, jamaat: '' };
  return { start: '', jamaat: '' };
}

function emptyRow(date) {
  const row = { date };
  PRAYER_ORDER.forEach((p) => { row[p] = { start: '', jamaat: '' }; });
  return row;
}

async function compressImage(file, maxDim = 1400) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function to24(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

function icsEscape(s) {
  return String(s).replace(/[\\;,]/g, (c) => '\\' + c);
}

function generateICS(schedules, mode) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prayer Times//EN', 'CALSCALE:GREGORIAN'];
  let count = 0;
  let skipped = 0;

  schedules.forEach((s) => {
    if (s.date.startsWith('unknown')) { skipped++; return; }
    const dateObj = new Date(s.date + 'T00:00:00');
    const isFriday = dateObj.getDay() === 5;
    const y = dateObj.getFullYear(), mo = pad2(dateObj.getMonth() + 1), da = pad2(dateObj.getDate());

    PRAYER_ORDER.forEach((p) => {
      const cell = s[p];
      const timeStr = mode === 'start' ? (cell.start || cell.jamaat) : (cell.jamaat || cell.start);
      const mins = parseTimeToMinutes(timeStr);
      if (mins === null) return;

      const label = mode === 'jamaat' && p === 'dhuhr' && isFriday ? "Jumu'ah" : PRAYER_LABELS[p];
      const t24 = to24(mins);
      const startH = pad2(Math.floor(mins / 60));
      const startM = pad2(mins % 60);
      const endMins = mins + 15;
      const endH = pad2(Math.floor(endMins / 60) % 24);
      const endM = pad2(endMins % 60);

      const summary = mode === 'start' ? `${label} \u2014 ${t24}` : `${label} \u2014 Jama'at ${t24}`;
      const alarmTrigger = mode === 'start' ? 'PT0M' : '-PT15M';
      const alarmDesc = mode === 'start' ? `${label} time` : `${label} jama'at in 15 minutes`;

      const uid = `${s.date}-${p}-${mode}-${Math.random().toString(36).slice(2, 9)}@prayer-times`;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${y}${mo}${da}T000000Z`,
        `DTSTART:${y}${mo}${da}T${startH}${startM}00`,
        `DTEND:${y}${mo}${da}T${endH}${endM}00`,
        `SUMMARY:${icsEscape(summary)}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsEscape(alarmDesc)}`,
        `TRIGGER:${alarmTrigger}`,
        'END:VALARM',
        'END:VEVENT'
      );
      count++;
    });
  });

  lines.push('END:VCALENDAR');
  return { ics: lines.join('\r\n'), count, skipped };
}

export default function PrayerTimesApp() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showJamaat, setShowJamaat] = useState(true);
  const [icsMsg, setIcsMsg] = useState(null);
  const [reminderMode, setReminderMode] = useState('jamaat');
  const fileInputRef = useRef(null);

  const downloadICS = () => {
    const { ics, count, skipped } = generateICS(schedules, reminderMode);
    if (count === 0) {
      setIcsMsg('No dated entries to export \u2014 rows without a real date are skipped.');
      return;
    }
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reminderMode === 'jamaat' ? 'jamaat-reminders.ics' : 'prayer-time-reminders.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const modeDesc = reminderMode === 'jamaat' ? '15 minutes before jama\u2019at' : 'right at prayer time';
    setIcsMsg(`${count} reminders exported (${modeDesc})${skipped ? `, ${skipped} undated rows skipped` : ''}. Open the downloaded file to add them to your Calendar or Reminders app.`);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem('prayer_schedules');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          const migrated = parsed.map((s) => {
            const row = { date: s.date };
            PRAYER_ORDER.forEach((p) => { row[p] = normalizeCell(s[p]); });
            return row;
          });
          setSchedules(migrated);
        }
      }
    } catch (e) {
      // no existing data
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem('prayer_schedules', JSON.stringify(schedules));
    } catch (e) {
      // storage full or unavailable — non-fatal
    }
  }, [schedules, loaded]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setLoading(true);
    const isPdf = file.type === 'application/pdf';
    setLoadingMsg(isPdf ? 'Reading PDF…' : 'Reading image…');
    try {
      const base64 = isPdf ? await fileToBase64(file) : await compressImage(file);
      setLoadingMsg('Extracting prayer times…');

      const prompt = `You are reading a ${isPdf ? 'PDF of a' : 'photo of a'} mosque/Islamic prayer timetable. It may show a single day, a full month calendar, or a full year spanning many months/pages, with rows per date and columns per prayer.

For each of the five daily prayers (Fajr, Dhuhr, Asr, Maghrib, Isha), extract BOTH:
- "start": the adhan/start/beginning time of the prayer
- "jamaat": the congregation/jamaat/iqamah time, if the timetable shows one separately

Ignore Sunrise/Shurooq/Jumu'ah-only columns. Not all timetables have separate jamaat times — if there's only one time listed for a prayer, put it in "start" and leave "jamaat" empty.

Return ONLY raw JSON, no markdown fences, no commentary, in this exact shape:
{"schedules":[{"date":"YYYY-MM-DD","fajr":{"start":"H:MM AM","jamaat":"H:MM AM"},"dhuhr":{"start":"H:MM PM","jamaat":"H:MM PM"},"asr":{"start":"H:MM PM","jamaat":"H:MM PM"},"maghrib":{"start":"H:MM PM","jamaat":"H:MM PM"},"isha":{"start":"H:MM PM","jamaat":"H:MM PM"}}]}

Rules:
- If the image shows a single day with no explicit date, use "unknown" as the date value.
- If it's a monthly or yearly calendar, include one entry per row/date you can read across every month/page present, inferring the month/year from any header text (otherwise use "unknown" for date and preserve day order).
- Times must be in "H:MM AM/PM" format.
- If a cell is unreadable or absent, use an empty string for that value rather than guessing.
- Return valid JSON only, with no explanatory text before or after it.`;

      const mediaType = isPdf ? 'application/pdf' : 'image/jpeg';

      const response = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64, mediaType, prompt }),
      });

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        throw new Error(errBody.error || `The request to read the ${isPdf ? 'PDF' : 'image'} failed.`);
      }
      const data = await response.json();
      const rawText = data.text;
      if (!rawText) throw new Error('No readable response came back.');

      let clean = rawText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
      let parsed;
      try {
        parsed = JSON.parse(clean);
      } catch {
        const firstBrace = clean.indexOf('{');
        const lastBrace = clean.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
          } catch {
            parsed = null;
          }
        }
      }
      if (!parsed) {
        throw new Error(
          isPdf
            ? "Couldn't fully read that PDF — a full year in one file can be a lot to process at once. Try splitting it into a few smaller PDFs (e.g. one per quarter) and uploading those instead."
            : "Couldn't make sense of the timetable in that photo. Try a clearer, well-lit shot."
        );
      }


      const extracted = (parsed.schedules || []).map((s) => {
        const row = {
          date: s.date && s.date !== 'unknown' ? s.date : `unknown-${Math.random().toString(36).slice(2, 8)}`,
        };
        let anyJamaat = false;
        PRAYER_ORDER.forEach((p) => {
          const cell = normalizeCell(s[p]);
          if (cell.jamaat) anyJamaat = true;
          row[p] = cell;
        });
        row.__hasJamaat = anyJamaat;
        return row;
      });

      if (extracted.length === 0) throw new Error('No prayer times were found in that photo.');
      if (!extracted.some((r) => r.__hasJamaat)) {
        setShowJamaat(false);
      }

      setSchedules((prev) => {
        const byDate = new Map(prev.map((s) => [s.date, s]));
        extracted.forEach((s) => {
          const { __hasJamaat, ...rest } = s;
          byDate.set(s.date, rest);
        });
        return Array.from(byDate.values()).sort((a, b) => (a.date > b.date ? 1 : -1));
      });
    } catch (e) {
      setError(e.message || 'Something went wrong reading that image.');
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  }, []);

  const updateCell = (date, field, sub, value) => {
    setSchedules((prev) => prev.map((s) => (s.date === date ? { ...s, [field]: { ...s[field], [sub]: value } } : s)));
  };

  const removeRow = (date) => {
    setSchedules((prev) => prev.filter((s) => s.date !== date));
  };

  const addManualRow = () => {
    const d = todayISO();
    setSchedules((prev) => {
      if (prev.some((s) => s.date === d)) return prev;
      return [...prev, emptyRow(d)].sort((a, b) => (a.date > b.date ? 1 : -1));
    });
  };

  const copyForReminders = async () => {
    const lines = schedules.map((s) => {
      const label = s.date.startsWith('unknown') ? '(date not specified)' : s.date;
      const parts = PRAYER_ORDER.map((p) => {
        const cell = s[p];
        if (showJamaat && cell.jamaat) return `${PRAYER_LABELS[p]} ${cell.start || '—'} (jamaat ${cell.jamaat})`;
        return `${PRAYER_LABELS[p]} ${cell.start || '—'}`;
      });
      return `${label}: ${parts.join(', ')}`;
    });
    const text = `Create reminders in my Reminders app for these prayer times${showJamaat ? ' (remind me at jamaat time where given, otherwise start time)' : ''}:\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy — select and copy the schedule manually.');
    }
  };

  const today = todayISO();
  const todaySchedule = schedules.find((s) => s.date === today) || schedules[0];

  return (
    <div style={{ minHeight: '100vh', background: '#12172B', color: '#F2EFE6', fontFamily: "'Inter', 'Helvetica Neue', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .fraunces { font-family: 'Fraunces', serif; }
        input[type=text]:focus { outline: 2px solid #D4A657; outline-offset: 1px; }
        button:focus-visible { outline: 2px solid #D4A657; outline-offset: 2px; }
        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: #3A4468; border-radius: 4px; }
      `}</style>

      <div style={{ maxWidth: 680, margin: '0 auto', padding: '28px 20px 60px' }}>
        <header style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#D4A657', marginBottom: 6 }}>
            Prayer Times
          </div>
          <h1 className="fraunces" style={{ fontSize: 30, fontWeight: 600, margin: 0, lineHeight: 1.15 }}>
            Photograph the timetable.<br />Never miss a prayer.
          </h1>
          <p style={{ fontSize: 13, color: '#8891B5', marginTop: 8, lineHeight: 1.5 }}>
            Works for anyone — no account needed. Upload your mosque's timetable and download a reminders file for your phone.
          </p>
        </header>

        {/* Horizon arc — signature element */}
        {todaySchedule && (
          <div style={{ marginBottom: 32, padding: '20px 18px', borderRadius: 16, background: 'linear-gradient(180deg, #171E38 0%, #131829 100%)', border: '1px solid #262E4C' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8891B5', marginBottom: 14 }}>
              {todaySchedule.date.startsWith('unknown') ? "Today's arc" : formatDateLabel(todaySchedule.date)}
            </div>
            <HorizonArc schedule={todaySchedule} showJamaat={showJamaat} />
          </div>
        )}

        {/* Upload */}
        <div
          style={{
            border: '1.5px dashed #3A4468',
            borderRadius: 16,
            padding: '28px 20px',
            textAlign: 'center',
            marginBottom: 20,
            background: '#161C36',
          }}
        >
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '10px 0' }}>
              <Loader2 size={26} color="#D4A657" style={{ animation: 'spin 1s linear infinite' }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
              <div style={{ fontSize: 14, color: '#C6CBE0' }}>{loadingMsg}</div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 12 }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: '#D4A657', color: '#12172B', border: 'none',
                    borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  <Camera size={17} /> Take photo
                </button>
                <label
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    background: 'transparent', color: '#E7E4D9', border: '1px solid #3A4468',
                    borderRadius: 10, padding: '10px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  <Upload size={16} /> Upload
                  <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0])} />
                </label>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
              <div style={{ fontSize: 12.5, color: '#7C86AC' }}>A photo, a monthly calendar, or a PDF of a full year — start and jamaat times both get picked up. Very long PDFs go better split by quarter.</div>
            </>
          )}
        </div>

        {error && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#3A1F27', border: '1px solid #6B3241', color: '#F0B8C2', borderRadius: 10, padding: '10px 14px', fontSize: 13.5, marginBottom: 20 }}>
            <span style={{ flex: 1 }}>{error}</span>
            <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', color: '#F0B8C2', cursor: 'pointer', padding: 0 }}>
              <X size={15} />
            </button>
          </div>
        )}

        {/* Schedule table */}
        {schedules.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8891B5' }}>
                {schedules.length} {schedules.length === 1 ? 'day' : 'days'} saved
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#C6CBE0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={showJamaat} onChange={(e) => setShowJamaat(e.target.checked)} />
                  Show jamaat times
                </label>
                <button
                  onClick={addManualRow}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid #3A4468', color: '#C6CBE0', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, cursor: 'pointer' }}
                >
                  <Plus size={13} /> Add day
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', borderRadius: 12, border: '1px solid #262E4C' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead>
                  <tr style={{ background: '#1B2242' }}>
                    <th style={thStyle}>Date</th>
                    {PRAYER_ORDER.map((p) => (
                      <th key={p} style={{ ...thStyle, minWidth: showJamaat ? 128 : 72 }}>{PRAYER_LABELS[p]}</th>
                    ))}
                    <th style={{ ...thStyle, width: 36 }}></th>
                  </tr>
                  {showJamaat && (
                    <tr style={{ background: '#1B2242' }}>
                      <th style={thStyle}></th>
                      {PRAYER_ORDER.map((p) => (
                        <th key={p} style={{ padding: '0 12px 8px', fontSize: 10, color: '#6B7396', fontWeight: 500, display: 'flex', gap: 14 }}>
                          <span style={{ width: 56 }}>Start</span><span>Jamaat</span>
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {schedules.map((s) => (
                    <tr key={s.date} style={{ borderTop: '1px solid #262E4C' }}>
                      <td style={{ ...tdStyle, color: '#9FA8CB', whiteSpace: 'nowrap' }}>
                        {s.date.startsWith('unknown') ? '—' : formatDateLabel(s.date)}
                      </td>
                      {PRAYER_ORDER.map((p) => (
                        <td key={p} style={tdStyle}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              type="text"
                              value={s[p].start}
                              placeholder="start"
                              onChange={(e) => updateCell(s.date, p, 'start', e.target.value)}
                              style={inputStyle}
                            />
                            {showJamaat && (
                              <input
                                type="text"
                                value={s[p].jamaat}
                                placeholder="jamaat"
                                onChange={(e) => updateCell(s.date, p, 'jamaat', e.target.value)}
                                style={{ ...inputStyle, color: '#D4A657' }}
                              />
                            )}
                          </div>
                        </td>
                      ))}
                      <td style={tdStyle}>
                        <button onClick={() => removeRow(s.date)} style={{ background: 'none', border: 'none', color: '#6B7396', cursor: 'pointer', padding: 4 }}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button
                onClick={() => setReminderMode('jamaat')}
                style={{
                  flex: 1, textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  border: reminderMode === 'jamaat' ? '1.5px solid #D4A657' : '1px solid #3A4468',
                  background: reminderMode === 'jamaat' ? 'rgba(212,166,87,0.12)' : 'transparent',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 600, color: reminderMode === 'jamaat' ? '#D4A657' : '#E7E4D9' }}>Jama'at reminders</div>
                <div style={{ fontSize: 11.5, color: '#8891B5', marginTop: 2 }}>Alerts 15 min before congregation — Jumu'ah on Fridays</div>
              </button>
              <button
                onClick={() => setReminderMode('start')}
                style={{
                  flex: 1, textAlign: 'left', padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  border: reminderMode === 'start' ? '1.5px solid #D4A657' : '1px solid #3A4468',
                  background: reminderMode === 'start' ? 'rgba(212,166,87,0.12)' : 'transparent',
                }}
              >
                <div style={{ fontSize: 13.5, fontWeight: 600, color: reminderMode === 'start' ? '#D4A657' : '#E7E4D9' }}>Prayer time reminders</div>
                <div style={{ fontSize: 11.5, color: '#8891B5', marginTop: 2 }}>Alerts right when each prayer begins</div>
              </button>
            </div>

            <button
              onClick={downloadICS}
              style={{
                marginTop: 12, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: '#D4A657', color: '#12172B',
                border: 'none', borderRadius: 10, padding: '13px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              <CalendarPlus size={17} />
              Download reminders (.ics)
            </button>
            <div style={{ fontSize: 12, color: '#6B7396', marginTop: 8, marginBottom: 16, textAlign: 'center', lineHeight: 1.5 }}>
              One file, one reminder per prayer per day. Works in any Calendar or Reminders app — no Claude needed. Anyone can use this.
            </div>
            {icsMsg && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: '#1B2242', border: '1px solid #3A4468', color: '#C6CBE0', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 }}>
                <Download size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ flex: 1 }}>{icsMsg}</span>
              </div>
            )}

            <button
              onClick={copyForReminders}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: copied ? '#2E4A3A' : 'transparent', color: copied ? '#8FD9AE' : '#9FA8CB',
                border: '1px solid #3A4468', borderRadius: 10, padding: '13px 16px', fontSize: 13.5, fontWeight: 500, cursor: 'pointer',
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copied — paste it back to Claude' : 'Or: copy schedule text for Claude to set up instead'}
            </button>
          </div>
        )}

        {schedules.length === 0 && !loading && (
          <div style={{ textAlign: 'center', color: '#6B7396', fontSize: 13.5, padding: '20px 0' }}>
            No timetable saved yet — take or upload a photo to get started.
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle = { textAlign: 'left', padding: '10px 12px', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8891B5', fontWeight: 600 };
const tdStyle = { padding: '8px 12px', verticalAlign: 'middle' };
const inputStyle = { width: 56, background: 'transparent', border: 'none', color: '#F2EFE6', fontSize: 13.5, padding: '4px 2px', fontFamily: 'inherit' };

function HorizonArc({ schedule, showJamaat }) {
  const points = PRAYER_ORDER.map((p) => {
    const cell = schedule[p];
    const time = showJamaat && cell.jamaat ? cell.jamaat : cell.start;
    return {
      key: p,
      label: PRAYER_LABELS[p],
      time,
      minutes: parseTimeToMinutes(time),
      Icon: PRAYER_ICONS[p],
    };
  }).filter((pt) => pt.minutes !== null);

  const RANGE_START = 3 * 60; // 3am
  const RANGE_END = 23 * 60; // 11pm

  return (
    <div style={{ position: 'relative', padding: '30px 6px 8px' }}>
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: 'linear-gradient(90deg, #2A3568 0%, #4A5694 15%, #D4A657 45%, #E8834A 65%, #6B3E7A 82%, #1B2242 100%)',
        }}
      />
      {points.map((pt) => {
        const pct = Math.min(100, Math.max(0, ((pt.minutes - RANGE_START) / (RANGE_END - RANGE_START)) * 100));
        return (
          <div key={pt.key} style={{ position: 'absolute', left: `${pct}%`, top: 0, transform: 'translateX(-50%)', textAlign: 'center', width: 60 }}>
            <div style={{ fontSize: 10, color: '#8891B5', marginBottom: 4, whiteSpace: 'nowrap' }}>{pt.label}</div>
            <div
              style={{
                width: 9, height: 9, borderRadius: '50%', background: '#F2EFE6',
                margin: '0 auto', boxShadow: '0 0 0 3px #12172B',
              }}
            />
            <div style={{ fontSize: 11, color: '#C6CBE0', marginTop: 4, whiteSpace: 'nowrap' }}>{pt.time}</div>
          </div>
        );
      })}
    </div>
  );
}
