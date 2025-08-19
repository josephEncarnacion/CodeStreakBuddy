import React from 'react';
import './App.css';

const STORAGE_KEY = 'csb_state_v2';

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

function getPetStageEmoji(xp) {
  if (xp < 50) return '🐣'; // Baby
  if (xp < 200) return '🦊'; // Teen
  return '🐲'; // Adult
}

const initialState = {
  streak: { current: 0, longest: 0, lastCheckInDate: null },
  xp: 0,
  tasks: [], // { id, text, done, rewarded, date }
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
        // Backward compatibility from v1
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
      streak: { current, longest, lastCheckInDate: today },
      xp: s.xp + 10
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
      rewarded: false,
      date: today
    };
    setState(s => ({ ...s, tasks: [newTask, ...s.tasks] }));
    setTaskText('');
  }

  function toggleTask(taskId) {
    setState(s => {
      let xpDelta = 0;
      const tasks = s.tasks.map(t => {
        if (t.id !== taskId) return t;
        const nowDone = !t.done;
        let rewarded = t.rewarded;
        if (nowDone && !rewarded) {
          xpDelta += 2;
          rewarded = true;
        }
        return { ...t, done: nowDone, rewarded };
      });
      return { ...s, tasks, xp: s.xp + xpDelta };
    });
  }

  function sameDayLocal(dateIsoString, dayString) {
    const d = new Date(dateIsoString);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}` === dayString;
  }

  async function syncFromGitHub() {
    const username = state.github.username?.trim();
    if (!username) return;
    setIsSyncing(true);
    try {
      const resp = await fetch(`https://api.github.com/users/${encodeURIComponent(username)}/events/public`, {
        headers: { 'Accept': 'application/vnd.github+json' }
      });
      if (!resp.ok) throw new Error('GitHub API error');
      const events = await resp.json();
      const hasPushToday = Array.isArray(events) && events.some(ev => ev && ev.type === 'PushEvent' && sameDayLocal(ev.created_at, today));

      setState(s => {
        let next = { ...s, github: { ...s.github, lastSyncDate: today, lastResult: hasPushToday ? 'commit-today' : 'none' } };
        if (hasPushToday && s.streak.lastCheckInDate !== today) {
          const last = s.streak.lastCheckInDate;
          let current = 1;
          if (last) {
            const diff = daysBetween(last, today);
            if (diff === 1) current = s.streak.current + 1; else current = 1;
          }
          const longest = Math.max(s.streak.longest, current);
          next = { ...next, streak: { current, longest, lastCheckInDate: today }, xp: s.xp + 10 };
        }
        return next;
      });
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
  const petEmoji = getPetStageEmoji(state.xp);

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
              <strong>XP:</strong> {state.xp}
            </div>
            <div>
              <strong>Streak:</strong> {state.streak.current} day(s)
            </div>
            <div>
              <strong>Best:</strong> {state.streak.longest}
            </div>
          </div>
          <button className="checkin" onClick={handleCheckIn}>
            {state.streak.lastCheckInDate === today ? 'Checked In ✅' : 'Check In Today'}
          </button>
          <small className="tip">Check in grants +10 XP.</small>
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
                Status: {state.github.lastResult === 'commit-today' ? 'Found commits today ✅' : state.github.lastResult === 'none' ? 'No commits found today' : state.github.lastResult === 'error' ? 'Error contacting GitHub' : 'Not synced yet'}
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
                  {task.done && <span className="badge">+2 XP</span>}
                </li>
              ))}
            </ul>
          )}
          <small className="tip">Completing a task once grants +2 XP.</small>
        </section>

        <footer>
          <span>Local only · Your data stays in your browser</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
