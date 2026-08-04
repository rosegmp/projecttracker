type RuntimeStatusClient = {
  rpc: (name: string) => PromiseLike<{
    data: Record<string, unknown> | null;
    error: { code?: string } | null;
  }>;
};

export type AppRuntimeStatus = {
  writesFrozen: boolean;
  message: string;
};

export async function getAppRuntimeStatus(client: RuntimeStatusClient): Promise<AppRuntimeStatus> {
  const { data, error } = await client.rpc('get_app_runtime_status');
  if (error) {
    const failure = new Error('Unable to read application maintenance status.') as Error & { code?: string };
    failure.code = error.code || 'runtime_status_failed';
    throw failure;
  }
  return {
    writesFrozen: data?.writesFrozen === true,
    message: String(data?.message || '').trim().slice(0, 300),
  };
}

export function maintenanceMessage(status: AppRuntimeStatus) {
  return status.message || 'Project Tracker is temporarily read-only while maintenance is in progress.';
}
