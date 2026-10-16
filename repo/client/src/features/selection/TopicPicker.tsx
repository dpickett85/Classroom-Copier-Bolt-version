/**
 * The copy-all-or-some step: shown after the two courses are picked, before
 * the pre-flight scan. "All" proceeds exactly as before; "Some" shows the
 * source course's topics with checkboxes, and only the checked ones are
 * scanned and transferred.
 */
import { useRef, useState } from 'react'
import type { CourseSummary } from '@classroom-copier/shared'
import { Button, NarrationBanner } from '../../components/shared'
import { getCourseTopics, isAbortError } from '../../lib/api-client'

interface TopicPickerProps {
  source: CourseSummary
  /** The step stays usable; a failed topic load is surfaced, not fatal. */
  onError?: (error: unknown) => void
  onBack: () => void
  /** null = copy all topics; an id list = copy only those. */
  onProceed: (topicIds: string[] | null) => void
}

export function TopicList({
  topics,
  selected,
  onToggle,
}: {
  topics: Array<{ id: string; name: string }>
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="topic-list" data-testid="topic-list" role="group" aria-label="Topics to copy">
      {topics.map((topic) => (
        <label key={topic.id} className="topic-row">
          <input
            type="checkbox"
            checked={selected.has(topic.id)}
            onChange={() => onToggle(topic.id)}
          />
          <span>{topic.name}</span>
        </label>
      ))}
    </div>
  )
}

export function TopicPicker({ source, onError, onBack, onProceed }: TopicPickerProps) {
  const [showList, setShowList] = useState(false)
  const [topics, setTopics] = useState<Array<{ id: string; name: string }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const onProceedRef = useRef(onProceed)
  onProceedRef.current = onProceed

  // Topics are fetched lazily, only when the teacher chooses "copy some".
  const chooseSome = () => {
    setShowList(true)
    if (topics != null || loading) return
    setLoading(true)
    getCourseTopics(source.id)
      .then((res) => {
        setTopics(res.topics)
        setSelected(new Set(res.topics.map((t) => t.id)))
      })
      .catch((error: unknown) => {
        if (!isAbortError(error)) onError?.(error)
      })
      .finally(() => setLoading(false))
  }

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (showList) {
    return (
      <div className="screen">
        <div className="ready-card">
          <h1>Choose the topics to copy</h1>
          <p>Only the classwork under the topics you check will be copied.</p>
          {loading ? (
            <p role="status">Loading topics…</p>
          ) : topics != null && topics.length > 0 ? (
            <TopicList topics={topics} selected={selected} onToggle={toggle} />
          ) : (
            <p>
              This course has no topics. <b>Copy all topics</b> will transfer everything in it.
            </p>
          )}
          <NarrationBanner glyph="i" variant="reassurance">
            Classwork without a topic is only copied when you choose “Copy all topics.”
          </NarrationBanner>
          <div className="ready-actions">
            <Button variant="secondary" onClick={() => setShowList(false)}>
              ← Back
            </Button>
            <Button
              onClick={() => onProceedRef.current([...selected])}
              disabled={loading || topics == null || selected.size === 0}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen">
      <div className="ready-card">
        <h1>Copy everything, or just some of it?</h1>
        <p>
          “{source.name}” has classwork organized into topics. You can copy all of them, or only
          the ones you pick.
        </p>
        <div
          className="ready-actions"
          style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
        >
          <Button onClick={() => onProceedRef.current(null)}>Copy all topics</Button>
          <Button variant="secondary" onClick={chooseSome}>
            Copy only some topics
          </Button>
        </div>
        <div className="ready-actions">
          <Button variant="secondary" onClick={onBack}>
            ← Back
          </Button>
        </div>
      </div>
    </div>
  )
}
