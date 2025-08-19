import React from 'react';
import './App.css';

const STORAGE_KEY = 'csb_state_v3';

function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(dateA, dateB) {
  if (!dateA || !dateB) return null;
  const start = new Date(`${dateA}T00:00:00`);
  const end = new Date(`${dateB}T00:00:00`);
  const ms = end - start;
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

function getPetStageEmoji(currentStreak) {
  if (currentStreak < 7) return '🐣'; // Baby: 0-6 days
  if (currentStreak < 21) return '🦊'; // Teen: 7-20 days
  return '🐲'; // Adult: 21+ days
}

const initialState = {
  streak: { current: 0, longest: 0, lastCheckInDate: null },
  tasks: [], // { id, text, done, date }
  github: { username: '', lastSyncDate: null, lastResult: null }
};

function App() {
  const [state, setState] = React.useState(initialState);
  const [taskText, setTaskText] = React.useState('');
  const [githubUsernameInput, setGithubUsernameInput] = React.useState('');
  const [isSyncing, setIsSyncing] = React.useState(false);
  const today = getTodayString();

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded = JSON.parse(raw);
        const merged = { ...initialState, ...loaded };
        // Backward compatibility
        if (!merged.github) merged.github = { username: '', lastSyncDate: null, lastResult: null };
        setState(merged);
        setGithubUsernameInput(merged.github.username || '');
      } else {
        setGithubUsernameInput('');
      }
    } catch (e) {
      // ignore malformed storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // ignore quota/storage errors
    }
  }, [state]);

  function handleCheckIn() {
    const last = state.streak.lastCheckInDate;
    if (last === today) return; // already checked in today

    let current = 1;
    if (last) {
      const diff = daysBetween(last, today);
      if (diff === 1) current = state.streak.current + 1;
      else current = 1;
    }
    const longest = Math.max(state.streak.longest, current);
    setState(s => ({
      ...s,
      streak: { current, longest, lastCheckInDate: today }
    }));
  }

  function handleAddTask(e) {
    e.preventDefault();
    const text = taskText.trim();
    if (!text) return;
    const newTask = {
      id: `${Date.now()}`,
      text,
      done: false,
      date: today
    };
    setState(s => ({ ...s, tasks: [newTask, ...s.tasks] }));
    setTaskText('');
  }

  function toggleTask(taskId) {
    setState(s => {
      const tasks = s.tasks.map(t => {
        if (t.id !== taskId) return t;
        const nowDone = !t.done;
        return { ...t, done: nowDone };
      });
      return { ...s, tasks };
    });
  }

  function computeStreaksFromDates(activeDateSet) {
    // longest streak over the set (assume up to 1 year)
    // Build sorted list of dates from set
    const sorted = Array.from(activeDateSet)
      .map(s => new Date(`${s}T00:00:00`))
      .sort((a, b) => a - b);
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const dt of sorted) {
      if (prev) {
        const diff = Math.round((dt - prev) / (1000 * 60 * 60 * 24));
        if (diff === 1) {
          run += 1;
        } else if (diff > 1) {
          run = 1;
        }
      } else {
        run = 1;
      }
      longest = Math.max(longest, run);
      prev = dt;
    }
    // find most recent active day
    const mostRecent = sorted.length ? sorted[sorted.length - 1] : null;
    // current streak ending at most recent contribution day
    let current = 0;
    if (mostRecent) {
      let Datee = new Date(mostRecent);
      while (true) {
        const y = Datee.getFullYear();
        const m = String(Datee.getMonth() + 1).padStart(2, '0');
        const d = String(Datee.getDate()).padStart(2, '0');
        const key = `${y}-${m}-${d}`;
        if (activeDateSet.has(key)) {
          current += 1;
          Datee.setDate(Datee.getDate() - 1);
        } else {
          break;
        }
      }
    }
    const lastCheckInDate = mostRecent
      ? `${mostRecent.getFullYear()}-${String(mostRecent.getMonth() + 1).padStart(2, '0')}-${String(mostRecent.getDate()).padStart(2, '0')}`
      : state.streak.lastCheckInDate;
    return { current, longest, lastCheckInDate };
  }

  function toYMD(dateLike) {
    const d = new Date(dateLike);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function extractActiveDates(payload) {
    const active = new Set();
    if (!payload) return active;
    // Shape A (jogruber v4): { contributions: [{ date, count }] }
    if (Array.isArray(payload.contributions)) {
      for (const c of payload.contributions) {
        const date = c?.date;
        const count = Number(c?.count ?? c?.contributionCount ?? 0);
        if (date && count > 0) active.add(String(date).slice(0, 10));
      }
    }
    // Shape B: { years: [ { contributions: [{ date, count }] } ] }
    if (Array.isArray(payload.years)) {
      for (const y of payload.years) {
        if (Array.isArray(y?.contributions)) {
          for (const c of y.contributions) {
            const date = c?.date;
            const count = Number(c?.count ?? c?.contributionCount ?? 0);
            if (date && count > 0) active.add(String(date).slice(0, 10));
          }
        }
      }
    }
    // Shape C: calendar weeks/days
    const weeks = payload?.calendar?.weeks || payload?.weeks || payload?.contributions?.weeks;
    if (Array.isArray(weeks)) {
      for (const w of weeks) {
        const days = w?.days || w?.contributionDays || w;
        if (Array.isArray(days)) {
          for (const d of days) {
            const date = d?.date || d?.weekday; // typically 'date'
            const count = Number(d?.count ?? d?.contributionCount ?? d?.contributions ?? 0);
            if (date && count > 0) active.add(String(date).slice(0, 10));
          }
        }
      }
    }
    // Shape D (deno.dev): flat contributions array in payload.contributions
    // already covered above; additionally, allow "data" wrapper
    if (payload.data) {
      const nested = extractActiveDates(payload.data);
      nested.forEach(d => active.add(d));
    }
    // Normalize dates that may be timestamps
    const normalized = new Set();
    for (const d of active) {
      normalized.add(/^\d{4}-\d{2}-\d{2}$/.test(d) ? d : toYMD(d));
    }
    return normalized;
  }

  async function syncFromGitHub() {
    const username = state.github.username?.trim();
    if (!username) return;
    setIsSyncing(true);
    try {
      // Primary: jogruber API (stable JSON)
      let resp = await fetch(`https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(username)}?y=last`, { headers: { 'Accept': 'application/json' } });
      let data = null;
      if (resp.ok) {
        data = await resp.json();
      } else {
        // Fallback: deno.dev API
        const url2 = `https://github-contributions-api.deno.dev/${encodeURIComponent(username)}.json`;
        const resp2 = await fetch(url2, { headers: { 'Accept': 'application/json' } });
        if (!resp2.ok) throw new Error('Contrib API error');
        data = await resp2.json();
      }
      const activeDates = extractActiveDates(data);
      const streaks = computeStreaksFromDates(activeDates);
      setState(s => ({ ...s, streaksFromGithub: true, streak: streaks, github: { ...s.github, lastSyncDate: today, lastResult: 'synced' } }));
    } catch (e) {
      setState(s => ({ ...s, github: { ...s.github, lastSyncDate: today, lastResult: 'error' } }));
    } finally {
      setIsSyncing(false);
    }
  }

  React.useEffect(() => {
    if (state.github.username && state.github.lastSyncDate !== today) {
      syncFromGitHub();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.github.username, today]);

  function saveGithubUsername(e) {
    e.preventDefault();
    setState(s => ({ ...s, github: { ...s.github, username: githubUsernameInput.trim() } }));
  }

  const todaysTasks = state.tasks.filter(t => t.date === today);
  const petEmoji = getPetStageEmoji(state.streak.current);

  return (
    <div className="App">
      <div className="container">
        <h1>CodeStreakBuddy</h1>

        <section className="pet-card">
          <div className="pet-emoji" aria-label="pet" title="Your Buddy">
            {petEmoji}
          </div>
          <div className="stats">
            <div>
              <strong>Streak:</strong> {state.streak.current} day(s)
            </div>
            <div>
              <strong>Best:</strong> {state.streak.longest}
            </div>
            {!state.github.username && (
            <>
              <button className="checkin" onClick={handleCheckIn}>
                {state.streak.lastCheckInDate === today ? 'Checked In ✅' : 'Check In Today'}
              </button>
         
            </>
          )}
          </div>
        
      
        </section>

        <section className="github-card">
          <h2>GitHub</h2>
          <form className="github-input-row" onSubmit={saveGithubUsername}>
            <input
              type="text"
              placeholder="Your GitHub username"
              value={githubUsernameInput}
              onChange={(e) => setGithubUsernameInput(e.target.value)}
            />
            <button type="submit">Save</button>
            {state.github.username ? (
              <button type="button" onClick={syncFromGitHub} disabled={isSyncing}>
                {isSyncing ? 'Syncing…' : 'Sync now'}
              </button>
            ) : null}
          </form>
          {state.github.username ? (
            <div className="github-status">
              <div>
                Status: {state.github.lastResult === 'synced' ? 'Synced ✅' : state.github.lastResult === 'error' ? 'Error contacting GitHub' : 'Not synced yet'}
              </div>
              <a className="gh-link" href={`https://github.com/${encodeURIComponent(state.github.username)}`} target="_blank" rel="noreferrer">
                View profile ↗
              </a>
            </div>
          ) : (
            <div className="empty">Add your GitHub username to enable auto check-in.</div>
          )}

          {state.github.username ? (
            <div className="gh-chart-wrap">
              <img
                className="gh-chart"
                src={`https://ghchart.rshah.org/4ade80/${encodeURIComponent(state.github.username)}`}
                alt="GitHub contribution chart"
              />
              <small className="tip">Chart courtesy of ghchart.rshah.org</small>
            </div>
          ) : null}
        </section>

        <section className="tasks-card">
          <h2>Today&apos;s Tasks</h2>
          <form onSubmit={handleAddTask} className="task-form">
            <input
              type="text"
              placeholder="What did you work on?"
              value={taskText}
              onChange={(e) => setTaskText(e.target.value)}
            />
            <button type="submit">Add</button>
          </form>
          {todaysTasks.length === 0 ? (
            <div className="empty">No tasks yet. Add one!</div>
          ) : (
            <ul className="task-list">
              {todaysTasks.map(task => (
                <li key={task.id} className={task.done ? 'done' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => toggleTask(task.id)}
                    />
                    <span>{task.text}</span>
                  </label>
                  {/* no XP badge, streak only */}
                </li>
              ))}
            </ul>
          )}
          <small className="tip">Use tasks to track what you did; they don’t affect streak.</small>
        </section>

        <footer>
          <span>Local only · Your data stays in your browser</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
