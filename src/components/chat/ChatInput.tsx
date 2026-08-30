import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useProjectStore } from '../../store/useProjectStore'
import './ChatPanels.css'

type ChatInputProps = {
  onPlanReady: () => void
}

const COPY = {
  title: '\u5bf9\u8bdd',
  placeholder: '\u63cf\u8ff0\u8981\u4fee\u7684\u5c0f\u8282\u548c\u97f3\u51c6',
  preset:
    '\u53ea\u628a\u4eba\u58f0\u7b2c3\u5c0f\u8282\u9ad8\u97f3\u4fee\u51c6',
  send: '\u53d1\u9001',
  parsing: '\u6b63\u5728\u89e3\u6790\u610f\u56fe...',
  parseSlow:
    '\u89e3\u6790\u8d85\u8fc7 8 \u79d2\uff0c\u53ef\u5207\u5230\u89c4\u5219\u6a21\u677f',
  parseFailed: '\u89e3\u6790\u5931\u8d25',
  retry: '\u91cd\u8bd5',
  template: '\u7528\u89c4\u5219\u6a21\u677f',
  waiting: '\u5bfc\u5165\u5e76\u5206\u6790\u540e\u53ef\u53d1\u9001',
}

export function ChatInput({ onPlanReady }: ChatInputProps) {
  const [text, setText] = useState('')
  const [lastSubmitted, setLastSubmitted] = useState('')
  const [showTemplateFallback, setShowTemplateFallback] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const status = useProjectStore((state) => state.status)
  const error = useProjectStore((state) => state.error)
  const plan = useProjectStore((state) => state.plan)
  const runParseIntent = useProjectStore((state) => state.runParseIntent)
  const applyRuleTemplatePlan = useProjectStore(
    (state) => state.applyRuleTemplatePlan,
  )
  const isParsing = status === 'parsing'
  const canSend =
    text.trim().length > 0 &&
    (status === 'analyzed' || status === 'plan_pending')
  const parseError = status === 'analyzed' && error ? error : null

  useEffect(() => {
    if (plan && status === 'plan_pending') {
      onPlanReady()
    }
  }, [onPlanReady, plan, status])

  useEffect(() => {
    if (!isParsing) {
      setShowTemplateFallback(false)
      return
    }

    const timer = window.setTimeout(() => {
      setShowTemplateFallback(true)
    }, 8000)

    return () => window.clearTimeout(timer)
  }, [isParsing])

  function submit(nextText = text) {
    const trimmed = nextText.trim()

    if (!trimmed || isParsing) {
      return
    }

    setLastSubmitted(trimmed)
    void runParseIntent(trimmed)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) {
      return
    }

    event.preventDefault()
    submit()
  }

  function handleTemplate() {
    const nextText = lastSubmitted || text || COPY.preset

    applyRuleTemplatePlan(nextText)
    onPlanReady()
  }

  return (
    <section className="side-section chat-panel" aria-label={COPY.title}>
      <div className="panel-title-row">
        <span>{COPY.title}</span>
        <button
          className="preset-button"
          type="button"
          onClick={() => {
            setText(COPY.preset)
            textRef.current?.focus()
          }}
        >
          {COPY.preset}
        </button>
      </div>

      <textarea
        ref={textRef}
        disabled={isParsing}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={COPY.placeholder}
        value={text}
      />

      <div className="chat-actions">
        <small>{canSend ? '' : COPY.waiting}</small>
        <button type="button" onClick={() => submit()} disabled={!canSend}>
          {COPY.send}
        </button>
      </div>

      {isParsing && (
        <div className="parse-skeleton">
          <div />
          <div />
          <strong>{COPY.parsing}</strong>
          {showTemplateFallback && (
            <div className="parse-slow-row">
              <span>{COPY.parseSlow}</span>
              <button type="button" onClick={handleTemplate}>
                {COPY.template}
              </button>
            </div>
          )}
        </div>
      )}

      {parseError && (
        <div className="chat-error-card">
          <span>{COPY.parseFailed}</span>
          <strong>{parseError.error_code}</strong>
          <p>{parseError.message}</p>
          <div>
            <button
              type="button"
              onClick={() => submit(lastSubmitted || text)}
              disabled={isParsing}
            >
              {COPY.retry}
            </button>
            <button type="button" onClick={handleTemplate}>
              {COPY.template}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
