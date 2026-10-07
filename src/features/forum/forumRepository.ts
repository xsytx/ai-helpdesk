import type { Answer, Thread, ThreadSort } from "@/entities/forum";

const STORAGE_KEY = "ai_helpdesk_forum_v1";

interface ForumData {
  threads: Thread[];
  answers: Answer[];
}

function readData(): ForumData {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedData();
  try {
    return JSON.parse(raw) as ForumData;
  } catch {
    return seedData();
  }
}

function writeData(data: ForumData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function seedData(): ForumData {
  const now = Date.now();
  const threads: Thread[] = [
    {
      id: "t1",
      authorId: "seed-avery",
      authorName: "Avery Chen",
      title: "Fall course registration deadline",
      body: "How do I register for fall courses if I missed the deadline?",
      createdAt: new Date(now - 2 * 60_000).toISOString(),
      answerCount: 2,
      score: 12,
    },
    {
      id: "t2",
      authorId: "seed-jacob",
      authorName: "Jacob Bob",
      title: "CS department office location",
      body: "Does anyone know where the CS department office moved this semester?",
      createdAt: new Date(now - 15 * 60_000).toISOString(),
      answerCount: 1,
      score: 8,
    },
    {
      id: "t3",
      authorId: "seed-maria",
      authorName: "Maria K.",
      title: "ECTS credit transfer",
      body: "Tips for the ECTS credit transfer process?",
      createdAt: new Date(now - 60 * 60_000).toISOString(),
      answerCount: 2,
      score: 21,
    },
  ];
  const answers: Answer[] = [
    {
      id: "a1",
      threadId: "t1",
      authorId: "seed-helper",
      authorName: "Dana S.",
      body: "Visit the registrar office in Building A, room 204. Bring your student ID and a signed add/drop form.",
      createdAt: new Date(now - 90_000).toISOString(),
      likes: 12,
      likedByUserIds: [],
    },
    {
      id: "a2",
      threadId: "t1",
      authorId: "seed-avery",
      authorName: "Avery Chen",
      body: "They also accept requests through the student portal under Academic Services.",
      createdAt: new Date(now - 60_000).toISOString(),
      likes: 3,
      likedByUserIds: [],
    },
    {
      id: "a3",
      threadId: "t2",
      authorId: "seed-maria",
      authorName: "Maria K.",
      body: "It is on the 3rd floor of the Engineering block, next to the faculty lounge.",
      createdAt: new Date(now - 10 * 60_000).toISOString(),
      likes: 8,
      likedByUserIds: [],
    },
    {
      id: "a4",
      threadId: "t3",
      authorId: "seed-jacob",
      authorName: "Jacob Bob",
      body: "Start with the international office — they have a checklist for outgoing credits.",
      createdAt: new Date(now - 50 * 60_000).toISOString(),
      likes: 21,
      likedByUserIds: [],
    },
    {
      id: "a5",
      threadId: "t3",
      authorId: "seed-avery",
      authorName: "Avery Chen",
      body: "Keep syllabi and graded work; you will need them for equivalency review.",
      createdAt: new Date(now - 45 * 60_000).toISOString(),
      likes: 9,
      likedByUserIds: [],
    },
  ];
  const data = { threads, answers };
  writeData(data);
  return data;
}

function syncThreadStats(data: ForumData, threadId: string) {
  const threadAnswers = data.answers.filter((a) => a.threadId === threadId);
  const thread = data.threads.find((t) => t.id === threadId);
  if (!thread) return;
  thread.answerCount = threadAnswers.length;
  thread.score = threadAnswers.reduce((max, a) => Math.max(max, a.likes), 0);
}

export function listThreads(sort: ThreadSort): Thread[] {
  const data = readData();
  const threads = [...data.threads];
  if (sort === "newest") {
    threads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } else {
    threads.sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt));
  }
  return threads;
}

export function getThread(threadId: string): Thread | undefined {
  return readData().threads.find((t) => t.id === threadId);
}

export function listAnswers(threadId: string): Answer[] {
  const answers = readData().answers.filter((a) => a.threadId === threadId);
  return answers.sort((a, b) => b.likes - a.likes || b.createdAt.localeCompare(a.createdAt));
}

export function createThread(input: {
  authorId: string;
  authorName: string;
  title: string;
  body: string;
}): Thread {
  const data = readData();
  const thread: Thread = {
    id: crypto.randomUUID(),
    authorId: input.authorId,
    authorName: input.authorName,
    title: input.title.trim(),
    body: input.body.trim(),
    createdAt: new Date().toISOString(),
    answerCount: 0,
    score: 0,
  };
  data.threads.unshift(thread);
  writeData(data);
  return thread;
}

export function createAnswer(input: {
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
}): Answer {
  const data = readData();
  const answer: Answer = {
    id: crypto.randomUUID(),
    threadId: input.threadId,
    authorId: input.authorId,
    authorName: input.authorName,
    body: input.body.trim(),
    createdAt: new Date().toISOString(),
    likes: 0,
    likedByUserIds: [],
  };
  data.answers.push(answer);
  syncThreadStats(data, input.threadId);
  writeData(data);
  return answer;
}

export function toggleLikeAnswer(answerId: string, userId: string): Answer {
  const data = readData();
  const answer = data.answers.find((a) => a.id === answerId);
  if (!answer) throw new Error("Answer not found");
  const liked = answer.likedByUserIds.includes(userId);
  if (liked) {
    answer.likedByUserIds = answer.likedByUserIds.filter((id) => id !== userId);
    answer.likes = Math.max(0, answer.likes - 1);
  } else {
    answer.likedByUserIds.push(userId);
    answer.likes += 1;
  }
  syncThreadStats(data, answer.threadId);
  writeData(data);
  return answer;
}
