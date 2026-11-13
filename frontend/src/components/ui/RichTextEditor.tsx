import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, ListOrdered, Code, Heading2, Quote } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface RichTextEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  disabled?: boolean
  /** Tone used for internal notes (amber background). */
  tone?: 'default' | 'note'
}

export function RichTextEditor({ value, onChange, minHeight = 120, disabled, tone = 'default', placeholder }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    editable: !disabled,
    editorProps: { attributes: { class: 'prose-sm focus:outline-none px-3 py-2', 'aria-label': placeholder ?? 'Rich text editor', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false })
  }, [value, editor])

  if (!editor) return null
  const btn = (active: boolean, onClick: () => void, icon: React.ReactNode, label: string) => (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick} className={cn('rounded p-1 hover:bg-surface-hover', active && 'bg-surface-muted text-fg')}>
      {icon}
    </button>
  )
  return (
    <div className={cn('rounded-sm border border-border', tone === 'note' ? 'bg-warning-soft' : 'bg-surface')}>
      <div className="flex gap-0.5 border-b border-border px-1 py-1 text-fg-secondary">
        {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold size={14} />, 'Bold')}
        {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic size={14} />, 'Italic')}
        {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={14} />, 'Heading')}
        {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List size={14} />, 'Bulleted list')}
        {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={14} />, 'Numbered list')}
        {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={14} />, 'Quote')}
        {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), <Code size={14} />, 'Code block')}
      </div>
      <EditorContent editor={editor} style={{ minHeight }} className="text-md [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h2]:text-lg [&_h2]:font-bold [&_blockquote]:border-l-2 [&_blockquote]:pl-2" />
    </div>
  )
}
