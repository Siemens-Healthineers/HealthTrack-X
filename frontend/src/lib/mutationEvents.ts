export const MUTATION_PREVIEW_CREATED_EVENT = 'htx:mutation-preview-created'

export function notifyMutationPreviewCreated(approvalId?: string) {
  window.dispatchEvent(new CustomEvent(MUTATION_PREVIEW_CREATED_EVENT, {
    detail: { approvalId },
  }))
}