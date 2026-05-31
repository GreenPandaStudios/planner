import type { Task, Person } from '../types';

interface GistFileContent {
  tasks: Task[];
  people?: Person[]; // Optional for backwards compatibility
  lastSyncedAt: number;
}

export async function createPrivateGist(pat: string, tasks: Task[], people: Person[]): Promise<string> {
  const fileContent: GistFileContent = {
    tasks,
    people,
    lastSyncedAt: Date.now(),
  };

  const response = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: 'Antigravity Capacity Planner Database (Private)',
      public: false,
      files: {
        'antigravity-planner-data.json': {
          content: JSON.stringify(fileContent, null, 2),
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to create Gist: ${response.statusText}. Details: ${err}`);
  }

  const data = await response.json();
  return data.id;
}

export async function fetchTasksFromGist(pat: string, gistId: string): Promise<{ tasks: Task[]; people: Person[] }> {
  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'GET',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Gist ${gistId}: ${response.statusText}`);
  }

  const data = await response.json();
  const file = data.files['antigravity-planner-data.json'];
  if (!file) {
    throw new Error('Gist does not contain antigravity-planner-data.json file.');
  }

  const parsed = JSON.parse(file.content) as GistFileContent;
  return {
    tasks: parsed.tasks || [],
    people: parsed.people || [],
  };
}

export async function saveTasksToGist(pat: string, gistId: string, tasks: Task[], people: Person[]): Promise<void> {
  const fileContent: GistFileContent = {
    tasks,
    people,
    lastSyncedAt: Date.now(),
  };

  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      files: {
        'antigravity-planner-data.json': {
          content: JSON.stringify(fileContent, null, 2),
        },
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to update Gist ${gistId}: ${response.statusText}. Details: ${err}`);
  }
}

export async function findExistingGist(pat: string): Promise<string | null> {
  const response = await fetch('https://api.github.com/gists', {
    method: 'GET',
    headers: {
      'Authorization': `token ${pat}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list Gists: ${response.statusText}`);
  }

  const gists = await response.json();
  for (const gist of gists) {
    if (gist.files && gist.files['antigravity-planner-data.json']) {
      return gist.id;
    }
  }

  return null;
}
