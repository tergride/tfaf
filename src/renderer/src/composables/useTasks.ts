import { readonly, ref } from 'vue';
import type { TaskProgress } from '../../../shared/contract.ts';

const DONE_TASK_LINGER_MS = 2500;

const tasks = ref<TaskProgress[]>([]);
let initialized = false;

function dismiss(id: string): void {
  tasks.value = tasks.value.filter((task) => task.id !== id);
}

export function useTasks() {
  if (!initialized) {
    initialized = true;
    window.tfaf.tasks.onProgress((task) => {
      const index = tasks.value.findIndex((candidate) => candidate.id === task.id);
      if (index >= 0) {
        tasks.value.splice(index, 1, task);
      } else {
        tasks.value.push(task);
      }
      if (task.state === 'done' || task.state === 'cancelled') {
        setTimeout(() => dismiss(task.id), DONE_TASK_LINGER_MS);
      }
    });
  }
  return { tasks: readonly(tasks), dismiss };
}
