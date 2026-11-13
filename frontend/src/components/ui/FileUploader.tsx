import { useRef, useState, type DragEvent } from 'react'
import { Paperclip } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface FileUploaderProps {
  onFiles: (files: File[]) => void
  accept?: string
  multiple?: boolean
  maxSizeMb?: number
  disabled?: boolean
  /** "dropzone" for forms, "button" for composers. */
  variant?: 'dropzone' | 'button'
  onError?: (msg: string) => void
}

export function FileUploader({ onFiles, accept, multiple = true, maxSizeMb = 20, disabled, variant = 'dropzone', onError }: FileUploaderProps) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const handle = (list: FileList | null) => {
    if (!list) return
    const files = Array.from(list)
    const tooBig = files.find((f) => f.size > maxSizeMb * 1024 * 1024)
    if (tooBig) {
      onError?.(`${tooBig.name} is larger than ${maxSizeMb} MB`)
      return
    }
    onFiles(files)
    if (input.current) input.current.value = ''
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (!disabled) handle(e.dataTransfer.files)
  }
  const hidden = <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => handle(e.target.files)} />
  if (variant === 'button')
    return (
      <>
        {hidden}
        <button type="button" aria-label="Attach file" title="Attach file" disabled={disabled} onClick={() => input.current?.click()} className="rounded p-1.5 text-fg-secondary hover:bg-surface-hover hover:text-fg disabled:opacity-40">
          <Paperclip size={16} />
        </button>
      </>
    )
  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn('flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed px-4 py-5 text-sm text-fg-secondary', over ? 'border-primary bg-primary-soft' : 'border-border-strong', disabled && 'opacity-50')}
    >
      {hidden}
      <Paperclip size={16} />
      <span>
        Drop files here or <span className="text-primary">browse</span>
      </span>
      <span className="text-xs">Max {maxSizeMb} MB each</span>
    </div>
  )
}
