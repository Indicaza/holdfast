import operation from './currentOperation.json'
import './CurrentOperation.css'

function toRoman(value) {
  const numerals = [
    ['M', 1000],
    ['CM', 900],
    ['D', 500],
    ['CD', 400],
    ['C', 100],
    ['XC', 90],
    ['L', 50],
    ['XL', 40],
    ['X', 10],
    ['IX', 9],
    ['V', 5],
    ['IV', 4],
    ['I', 1],
  ]

  let remaining = value
  let result = ''

  for (const [symbol, amount] of numerals) {
    while (remaining >= amount) {
      result += symbol
      remaining -= amount
    }
  }

  return result
}

function Assignment({ assignment }) {
  const isOpen = assignment.name === 'Open'

  return (
    <span
      className={`current-operation__assignee${isOpen ? ' current-operation__assignee--open' : ''}`}
      tabIndex="0"
      aria-label={`${assignment.name}: ${assignment.responsibility}. ${assignment.detail}`}
    >
      {assignment.avatar ? (
        <img
          className="current-operation__avatar current-operation__avatar--image"
          src={assignment.avatar}
          alt=""
          width="40"
          height="40"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="current-operation__avatar" aria-hidden="true">
          {assignment.initials}
        </span>
      )}
      <span className="current-operation__tooltip" role="tooltip">
        <strong>{assignment.name}</strong>
        <span>{assignment.responsibility}</span>
        <small>{assignment.detail}</small>
      </span>
    </span>
  )
}

function Reward({ reward, compact = false }) {
  if (!reward) {
    return <span className="current-operation__reward-empty">None</span>
  }

  return (
    <div className={`current-operation__reward${compact ? ' current-operation__reward--compact' : ''}`}>
      <div className="current-operation__reward-values">
        {reward.rep > 0 && (
          <span>
            <strong>{reward.rep}</strong> Rep
          </span>
        )}
        {reward.marks > 0 && (
          <span>
            <strong>{reward.marks}</strong> Marks
          </span>
        )}
      </div>
      {reward.extra && <small>{reward.extra}</small>}
    </div>
  )
}

function BacklogMission({ mission }) {
  return (
    <details className="current-operation__backlog-mission">
      <summary>
        <div className="current-operation__backlog-title">
          <span className="current-operation__backlog-priority">{mission.priority}</span>
          <h4>{mission.title}</h4>
          <p>{mission.audience}</p>
        </div>
        <Reward reward={mission.reward} compact />
        <span className="current-operation__backlog-toggle" aria-hidden="true">+</span>
      </summary>

      <div className="current-operation__backlog-body">
        <div>
          <p className="current-operation__backlog-description">{mission.description}</p>
          <ul className="current-operation__backlog-objectives">
            {mission.objectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>

        <dl className="current-operation__backlog-meta">
          <div>
            <dt>Authority</dt>
            <dd>{mission.authority}</dd>
          </div>
          <div>
            <dt>Reward basis</dt>
            <dd>{mission.rewardBasis}</dd>
          </div>
        </dl>
      </div>
    </details>
  )
}

function CurrentOperation() {
  return (
    <section className="current-operation" aria-labelledby="current-operation-title">
      <header className="current-operation__header">
        <div className="current-operation__heading">
          <p className="current-operation__eyebrow">{operation.campaign}</p>
          <div className="current-operation__meta" aria-label="Mission status">
            <span>{operation.missionLabel}</span>
            <span className="current-operation__status">{operation.status}</span>
          </div>
          <h2 id="current-operation-title">{operation.title}</h2>
          <p className="current-operation__summary">{operation.summary}</p>
          <div className="current-operation__mission-meta">
            <span>Issued by {operation.issuedBy}</span>
            <span>{operation.rewardTier}</span>
          </div>
        </div>

        <div className="current-operation__insignia" aria-hidden="true">
          <span>♜</span>
        </div>
      </header>

      <div className="current-operation__columns" aria-hidden="true">
        <span />
        <span>Objective</span>
        <span>Priority</span>
        <span>Assigned</span>
        <span>Reward</span>
      </div>

      <div className="current-operation__objectives">
        {operation.objectives.map((objective, index) => (
          <article className="current-operation__objective" key={objective.title}>
            <div className="current-operation__objective-number" aria-hidden="true">
              {toRoman(index + 1)}
            </div>

            <div className="current-operation__objective-copy">
              <h3>{objective.title}</h3>
              <p>{objective.description}</p>
              <p className="current-operation__need">
                <span>Need</span>
                {objective.need}
              </p>
            </div>

            <div className="current-operation__objective-status" aria-label={`Priority: ${objective.status}`}>
              <span>{objective.status}</span>
            </div>

            <div className="current-operation__coverage" aria-label="Assigned members">
              <div className="current-operation__assignment-row">
                {objective.assignments.length > 0 ? (
                  objective.assignments.map((assignment, assignmentIndex) => (
                    <Assignment
                      assignment={assignment}
                      key={`${objective.title}-${assignment.name}-${assignment.responsibility}-${assignmentIndex}`}
                    />
                  ))
                ) : (
                  <span className="current-operation__unassigned">No one yet</span>
                )}
              </div>
            </div>

            <Reward reward={objective.reward} />
          </article>
        ))}
      </div>

      <footer className="current-operation__end-state">
        <span>Mission complete when</span>
        <p>{operation.completeWhen}</p>
      </footer>

      <details className="current-operation__backlog">
        <summary className="current-operation__backlog-summary">
          <div className="current-operation__backlog-summary-copy">
            <p className="current-operation__backlog-eyebrow">Mission backlog</p>
            <h3>What comes next.</h3>
            <p>{operation.backlogSummary}</p>
          </div>
          <div className="current-operation__backlog-summary-meta">
            <span>{operation.backlog.length} planned missions</span>
            <span className="current-operation__backlog-master-toggle" aria-hidden="true">+</span>
          </div>
        </summary>

        <div className="current-operation__backlog-content">
          <div className="current-operation__backlog-list">
            {operation.backlog.map((mission) => (
              <BacklogMission key={mission.title} mission={mission} />
            ))}
          </div>

          <div className="current-operation__reward-policy">
            <span>Reward policy</span>
            <p>{operation.rewardPolicy}</p>
          </div>
        </div>
      </details>
    </section>
  )
}

export default CurrentOperation
