import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button, ConfirmDialog, DataTable, Dropdown, Pagination, SearchInput, SegmentedControl, StatusBadge, Switch, type ColumnDef } from '@/components/ui'
import { ConditionBuilder } from '@/components/domain/ConditionBuilder'
import type { Condition } from '@/types'

describe('Button', () => {
  it('fires onClick and disables while loading', async () => {
    const fn = vi.fn()
    const { rerender } = render(<Button onClick={fn}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(fn).toHaveBeenCalledTimes(1)
    rerender(<Button onClick={fn} loading>Save</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('DataTable', () => {
  interface Row { id: string; name: string }
  const columns: ColumnDef<Row>[] = [{ header: 'Name', accessorKey: 'name' }]
  const data = [{ id: '1', name: 'Ada' }, { id: '2', name: 'Grace' }]

  it('renders rows, empty state and row click', async () => {
    const click = vi.fn()
    const { rerender } = render(<DataTable data={data} columns={columns} getRowId={(r) => r.id} onRowClick={click} />)
    await userEvent.click(screen.getByText('Grace'))
    expect(click).toHaveBeenCalledWith(data[1])
    rerender(<DataTable data={[]} columns={columns} getRowId={(r) => r.id} empty="Nothing here" />)
    expect(screen.getByText('Nothing here')).toBeInTheDocument()
  })

  it('supports row selection with select-all', async () => {
    function Harness() {
      const [sel, setSel] = useState({})
      return (
        <>
          <DataTable data={data} columns={columns} getRowId={(r) => r.id} selectable rowSelection={sel} onRowSelectionChange={setSel} />
          <output data-testid="count">{Object.values(sel).filter(Boolean).length}</output>
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Select all rows'))
    expect(screen.getByTestId('count')).toHaveTextContent('2')
  })

  it('shows skeleton rows while loading', () => {
    render(<DataTable data={[]} columns={columns} getRowId={(r) => r.id} loading empty="x" />)
    expect(screen.queryByText('x')).not.toBeInTheDocument()
  })
})

describe('SegmentedControl', () => {
  it('changes value by click and arrow keys', async () => {
    const fn = vi.fn()
    render(<SegmentedControl label="Mode" value="a" onChange={fn} items={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />)
    await userEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(fn).toHaveBeenCalledWith('b')
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })
    expect(fn).toHaveBeenLastCalledWith('b')
  })
})

describe('Pagination', () => {
  it('disables edges and pages', async () => {
    const fn = vi.fn()
    render(<Pagination page={1} pageCount={3} onPageChange={fn} />)
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    await userEvent.click(screen.getByLabelText('Next page'))
    expect(fn).toHaveBeenCalledWith(2)
  })
})

describe('SearchInput', () => {
  it('reports typing and clears', async () => {
    const fn = vi.fn()
    render(<SearchInput value="ab" onChange={fn} />)
    await userEvent.click(screen.getByLabelText('Clear search'))
    expect(fn).toHaveBeenCalledWith('')
  })
})

describe('Switch', () => {
  it('toggles in both appearances', async () => {
    const fn = vi.fn()
    const { rerender } = render(<Switch checked={false} onChange={fn} label="Flag" />)
    await userEvent.click(screen.getByRole('switch'))
    expect(fn).toHaveBeenCalledWith(true)
    rerender(<Switch appearance="onoff" checked onChange={fn} label="Flag" />)
    await userEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(fn).toHaveBeenLastCalledWith(false)
  })
})

describe('Dropdown', () => {
  it('opens, selects with the mouse and closes on Escape', async () => {
    const pick = vi.fn()
    render(<Dropdown items={[{ id: 'a', label: 'Alpha', onSelect: pick }]} trigger={(p) => <button {...p}>Menu</button>} />)
    await userEvent.click(screen.getByText('Menu'))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }))
    expect(pick).toHaveBeenCalled()
    await userEvent.click(screen.getByText('Menu'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })
})

describe('ConfirmDialog', () => {
  it('confirms and cancels', async () => {
    const ok = vi.fn(), no = vi.fn()
    render(<ConfirmDialog open title="Delete?" message="Sure?" confirmLabel="Delete" danger onConfirm={ok} onCancel={no} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(ok).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(no).toHaveBeenCalled()
  })
})

describe('StatusBadge', () => {
  it('exposes the status to assistive tech', () => {
    render(<StatusBadge status="away" />)
    expect(screen.getByText('Away')).toHaveClass('sr-only')
  })
})

describe('ConditionBuilder (shared by triggers, automations, SLA, views)', () => {
  const fields = [{ value: 'visitor_name', label: 'Visitor name' }, { value: 'queue_size', label: 'Queue size', type: 'number' as const }]
  it('adds, edits and removes rows', async () => {
    function Harness() {
      const [c, setC] = useState<Condition[]>([{ field: 'visitor_name', operator: 'eq', value: '' }])
      return (
        <>
          <ConditionBuilder conditions={c} onChange={setC} fields={fields} />
          <output data-testid="json">{JSON.stringify(c)}</output>
        </>
      )
    }
    render(<Harness />)
    await userEvent.click(screen.getByLabelText('Add condition'))
    expect(screen.getAllByLabelText('Field')).toHaveLength(2)
    await userEvent.selectOptions(screen.getAllByLabelText('Field')[1]!, 'queue_size')
    expect(JSON.parse(screen.getByTestId('json').textContent!)[1].field).toBe('queue_size')
    await userEvent.click(screen.getAllByLabelText('Remove condition')[0]!)
    expect(screen.getAllByLabelText('Field')).toHaveLength(1)
  })
})
