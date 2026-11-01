import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/ui/Modal'

export function RenameDialog({
  title,
  label,
  initial,
  placeholder,
  onSubmit,
  onClose,
}: {
  title: string
  label?: string
  initial: string
  placeholder?: string
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = () => {
    const name = value.trim()
    if (!name) {
      inputRef.current?.focus()
      return
    }
    onSubmit(name)
    onClose()
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={!value.trim()}>
            保存
          </button>
        </>
      }
    >
      <label className="block">
        {label && <span className="mb-1.5 block text-xs text-dim">{label}</span>}
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={placeholder}
          maxLength={80}
          className="input"
        />
      </label>
    </Modal>
  )
}
