import { editCuttingTree, type CuttingTreeEdit, type CuttingTreeEditError } from '../../domain/cutting-tree/edit-cutting-tree'
import type { Part } from '../../domain/model/part'
import { computeAreaMetrics, type OptimizePanelInput, type PanelCuttingPlan } from '../../domain/optimizer/plan-with-strategy'
import { createCuttingPlanScene } from './cutting-plan-scene'

export type EditingInput = Omit<OptimizePanelInput, 'parts'> & { readonly parts: readonly Part[] }
export interface PlanEditingSession {
  readonly optimizedPlan: PanelCuttingPlan
  readonly input: EditingInput
  readonly history: readonly PanelCuttingPlan[]
  readonly cursor: number
}
export type PlanEditingResult =
  | { readonly ok: true; readonly session: PlanEditingSession }
  | { readonly ok: false; readonly error: CuttingTreeEditError }

export function createPlanEditingSession(plan: PanelCuttingPlan, input: EditingInput): PlanEditingResult {
  const sceneResult = createCuttingPlanScene(plan, input)
  if (sceneResult.status !== 'valid') {
    return {
      ok: false,
      error: {
        message: sceneResult.status === 'invalid' ? sceneResult.message : 'No cutting plan.',
        issues: [],
      },
    }
  }
  try {
    const optimizedPlan = structuredClone(plan)
    return {
      ok: true,
      session: {
        optimizedPlan,
        input: structuredClone(input),
        history: [optimizedPlan],
        cursor: 0,
      },
    }
  } catch {
    return { ok: false, error: { message: 'The cutting plan could not be snapshotted for editing.', issues: [] } }
  }
}

export function currentEditingPlan(session: PlanEditingSession): PanelCuttingPlan {
  return session.history[session.cursor] ?? session.optimizedPlan
}

export function applyPlanEdit(session: PlanEditingSession, edit: CuttingTreeEdit): PlanEditingResult {
  const currentPlan = currentEditingPlan(session)
  const editResult = editCuttingTree(currentPlan.tree, session.input, edit)
  if (!editResult.ok) return editResult
  const sceneResult = createCuttingPlanScene({ ...currentPlan, tree: editResult.tree }, session.input)
  if (sceneResult.status !== 'valid') {
    return {
      ok: false,
      error: {
        message: sceneResult.status === 'invalid' ? sceneResult.message : 'No cutting plan.',
        issues: [],
      },
    }
  }
  const placements = sceneResult.scene.parts.map(placedPart => ({
    partId: placedPart.part.id,
    copyIndex: placedPart.copyIndex,
    orientation: placedPart.orientation,
    region: placedPart.region,
    dimensions: placedPart.dimensions,
  }))
  const plan = {
    ...currentPlan,
    tree: editResult.tree,
    placements,
    metrics: computeAreaMetrics(session.input.panel, placements),
  }
  return {
    ok: true,
    session: {
      ...session,
      history: [...session.history.slice(0, session.cursor + 1), plan],
      cursor: session.cursor + 1,
    },
  }
}

export function undoPlanEdit(session: PlanEditingSession): PlanEditingSession {
  return session.cursor === 0 ? session : { ...session, cursor: session.cursor - 1 }
}

export function redoPlanEdit(session: PlanEditingSession): PlanEditingSession {
  return session.cursor === session.history.length - 1 ? session : { ...session, cursor: session.cursor + 1 }
}

/** An explicit reset discards both undo and redo history. */
export function resetPlanEdits(session: PlanEditingSession): PlanEditingSession {
  return { ...session, history: [session.optimizedPlan], cursor: 0 }
}
