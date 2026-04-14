import { test, expect, Page } from "@playwright/test";
import { BASE_URL, loginAsAdmin } from "./support";

type TemplateId =
    | "top_teams_by_score"
    | "first_blood_hunters"
    | "category_masters"
    | "first_clear_each_category"
    | "perfect_solvers"
    | "solve_count_champions"
    | "first_blood_by_category"
    | "no_hints_solvers";

type EntityType = "team" | "user" | "solve";

interface TemplateSummary {
    id: TemplateId;
    name: string;
    customizable_params: string[];
}

interface ChallengeRecord {
    id: number;
    name: string;
    value: number;
    category: string;
}

interface SubmissionRecord {
    id: number;
    team_id: number | null;
    user_id: number | null;
    type: string;
    date: string;
    challenge_id: number;
    challenge: ChallengeRecord;
}

interface AwardRecord {
    id: number;
    user_id: number | null;
    team_id: number | null;
    name: string | null;
    description: string | null;
    value: number;
    category: string | null;
}

interface UserRecord {
    id: number;
    name: string;
    team_id: number | null;
    bracket_id: number | null;
}

interface TeamRecord {
    id: number;
    name: string;
    bracket_id: number | null;
}

interface HintUsageRecord {
    challengeId: number;
    teamId: number | null;
    userId: number | null;
}

interface SolveRow {
    solveId: number;
    teamId: number | null;
    userId: number | null;
    challengeId: number;
    challengeName: string;
    category: string;
    challengeValue: number;
    solveDate: string;
    solveEpochMs: number;
    isFirstBlood: boolean;
    hintUsed: boolean;
    wrongBefore: number;
}

interface Dataset {
    templates: TemplateSummary[];
    challenges: ChallengeRecord[];
    submissions: SubmissionRecord[];
    awards: AwardRecord[];
    users: UserRecord[];
    teams: TeamRecord[];
    hintUsages: HintUsageRecord[];
    correctSolves: SolveRow[];
    primaryCategory: string;
    primaryChallengeId: number;
    filteredUserTeamId: number | null;
}

interface TemplateScenario {
    params: Record<string, number | string>;
    entityType: EntityType;
    expandable: boolean;
}

interface PreviewResultRow {
    entity_id: number;
    entity_name: string;
    metric_value: number;
    category?: string | null;
    team_name?: string | null;
    user_name?: string | null;
    solved_count?: number | null;
    rank?: number | null;
    last_solve_date?: string | null;
}

interface AggregateRow {
    entity_id: number;
    entity_name: string;
    bracket_id: number | null;
    team_id?: number | null;
    team_name?: string | null;
    solved_count: number;
    total_score: number;
    first_blood_count: number;
    category_clear_count: number;
    perfect_solve_count: number;
    wrong_count: number;
    last_solve_date: string | null;
    last_solve_epoch: number | null;
    rank?: number | null;
}

const TEMPLATE_CASES: Array<{ id: TemplateId; name: string; expandable: boolean }> = [
    { id: "top_teams_by_score", name: "Top Teams by Score", expandable: false },
    { id: "first_blood_hunters", name: "First Blood Hunters", expandable: true },
    { id: "category_masters", name: "Category Masters", expandable: true },
    { id: "first_clear_each_category", name: "First Full-Clear By Category", expandable: false },
    { id: "perfect_solvers", name: "Perfect Solvers", expandable: true },
    { id: "solve_count_champions", name: "Solve Count Champions", expandable: true },
    { id: "first_blood_by_category", name: "First Blood by Category", expandable: false },
    { id: "no_hints_solvers", name: "No Hints Solvers", expandable: true },
];

let dataset: Dataset;

function uniqueById<T extends { id: number }>(items: T[]): T[] {
    const seen = new Set<number>();
    return items.filter((item) => {
        if (seen.has(item.id)) {
            return false;
        }
        seen.add(item.id);
        return true;
    });
}

function parseEpoch(date: string | null | undefined): number | null {
    if (!date) {
        return null;
    }
    const value = Date.parse(date);
    return Number.isNaN(value) ? null : value;
}

async function fetchJson<T>(page: Page, path: string): Promise<T> {
    const response = await page.request.get(`${BASE_URL}${path}`);
    expect(response.ok(), `GET ${path} phải trả về 2xx`).toBeTruthy();
    return await response.json() as T;
}

async function fetchAllPaginated<T>(page: Page, path: string): Promise<T[]> {
    const results: T[] = [];
    let currentPage = 1;

    while (true) {
        const separator = path.includes("?") ? "&" : "?";
        const body = await fetchJson<any>(page, `${path}${separator}page=${currentPage}&per_page=100`);
        expect(body.success, `Endpoint ${path} phải success`).toBeTruthy();
        results.push(...(body.data ?? []));

        const pages = body.meta?.pagination?.pages;
        if (!pages || currentPage >= pages) {
            break;
        }
        currentPage += 1;
    }

    return results;
}

function parseHintChallengeId(award: AwardRecord, challengeNameToId: Map<string, number>): number | null {
    const numericMatch = award.name?.match(/(\d+)/);
    if (numericMatch) {
        return Number(numericMatch[1]);
    }

    const description = award.description ?? "";
    for (const [challengeName, challengeId] of challengeNameToId.entries()) {
        if (description.includes(challengeName)) {
            return challengeId;
        }
    }

    return null;
}

function buildHintUsages(awards: AwardRecord[], challenges: ChallengeRecord[]): HintUsageRecord[] {
    const challengeNameToId = new Map(challenges.map((challenge) => [challenge.name, challenge.id]));
    const usages: HintUsageRecord[] = [];

    for (const award of awards) {
        if ((award.category ?? "").toLowerCase() !== "hint") {
            continue;
        }

        const challengeId = parseHintChallengeId(award, challengeNameToId);
        if (!challengeId) {
            continue;
        }

        usages.push({
            challengeId,
            teamId: award.team_id,
            userId: award.user_id,
        });
    }

    return usages;
}

function buildCorrectSolveRows(submissions: SubmissionRecord[], hintUsages: HintUsageRecord[]): SolveRow[] {
    const correctSubmissions = submissions
        .filter((submission) => submission.type === "correct")
        .map((submission) => ({
            ...submission,
            solveEpochMs: parseEpoch(submission.date) ?? 0,
        }))
        .sort((left, right) => left.solveEpochMs - right.solveEpochMs || left.id - right.id);

    const incorrectSubmissions = submissions
        .filter((submission) => submission.type === "incorrect")
        .map((submission) => ({
            ...submission,
            solveEpochMs: parseEpoch(submission.date) ?? 0,
        }));

    const firstBloodEpochByChallenge = new Map<number, number>();
    for (const submission of correctSubmissions) {
        const previous = firstBloodEpochByChallenge.get(submission.challenge_id);
        if (previous === undefined || submission.solveEpochMs < previous) {
            firstBloodEpochByChallenge.set(submission.challenge_id, submission.solveEpochMs);
        }
    }

    return correctSubmissions.map((submission) => {
        const hintUsed = hintUsages.some((usage) => {
            if (usage.challengeId !== submission.challenge_id) {
                return false;
            }
            return usage.teamId === submission.team_id || usage.userId === submission.user_id;
        });

        const wrongBefore = incorrectSubmissions.filter((wrongSubmission) => {
            if (wrongSubmission.challenge_id !== submission.challenge_id) {
                return false;
            }
            if (wrongSubmission.solveEpochMs >= submission.solveEpochMs) {
                return false;
            }
            return wrongSubmission.team_id === submission.team_id || wrongSubmission.user_id === submission.user_id;
        }).length;

        return {
            solveId: submission.id,
            teamId: submission.team_id,
            userId: submission.user_id,
            challengeId: submission.challenge_id,
            challengeName: submission.challenge.name,
            category: submission.challenge.category,
            challengeValue: submission.challenge.value,
            solveDate: submission.date,
            solveEpochMs: submission.solveEpochMs,
            isFirstBlood: firstBloodEpochByChallenge.get(submission.challenge_id) === submission.solveEpochMs,
            hintUsed,
            wrongBefore,
        } satisfies SolveRow;
    });
}

function mostFrequentCategory(solves: SolveRow[]): string {
    const counts = new Map<string, number>();
    for (const solve of solves) {
        counts.set(solve.category, (counts.get(solve.category) ?? 0) + 1);
    }
    const [best] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    return best?.[0] ?? "";
}

function mostSolvedChallengeId(solves: SolveRow[]): number {
    const counts = new Map<number, number>();
    for (const solve of solves) {
        counts.set(solve.challengeId, (counts.get(solve.challengeId) ?? 0) + 1);
    }
    const [best] = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0]);
    return best?.[0] ?? 0;
}

async function buildDataset(page: Page): Promise<Dataset> {
    const [templateBody, challengeBody, submissions, awardBody, users, teams] = await Promise.all([
        fetchJson<any>(page, "/admin/rewards/templates"),
        fetchJson<any>(page, "/api/v1/challenges?view=admin"),
        fetchAllPaginated<SubmissionRecord>(page, "/api/v1/submissions"),
        fetchJson<any>(page, "/api/v1/awards"),
        fetchAllPaginated<UserRecord>(page, "/api/v1/users?view=admin"),
        fetchAllPaginated<TeamRecord>(page, "/api/v1/teams?view=admin"),
    ]);

    expect(templateBody.success).toBeTruthy();
    expect(challengeBody.success).toBeTruthy();
    expect(awardBody.success).toBeTruthy();

    const templates = templateBody.templates as TemplateSummary[];
    const challenges = uniqueById(challengeBody.data as ChallengeRecord[]);
    const awards = awardBody.data as AwardRecord[];
    const uniqueUsers = uniqueById(users);
    const uniqueTeams = uniqueById(teams);
    const hintUsages = buildHintUsages(awards, challenges);
    const correctSolves = buildCorrectSolveRows(submissions, hintUsages);

    expect(correctSolves.length, "Hệ thống cần có ít nhất 1 correct submission để verify reward query").toBeGreaterThan(0);

    return {
        templates,
        challenges,
        submissions,
        awards,
        users: uniqueUsers,
        teams: uniqueTeams,
        hintUsages,
        correctSolves,
        primaryCategory: mostFrequentCategory(correctSolves),
        primaryChallengeId: mostSolvedChallengeId(correctSolves),
        filteredUserTeamId: uniqueUsers.find((user) => user.team_id !== null)?.team_id ?? null,
    } satisfies Dataset;
}

function awardSumByEntity(awards: AwardRecord[], key: "team_id" | "user_id"): Map<number, number> {
    const sums = new Map<number, number>();
    for (const award of awards) {
        const entityId = award[key];
        if (entityId === null || entityId === undefined || award.value === 0) {
            continue;
        }
        sums.set(entityId, (sums.get(entityId) ?? 0) + Number(award.value));
    }
    return sums;
}

function wrongCountByEntity(submissions: SubmissionRecord[], key: "team_id" | "user_id"): Map<number, number> {
    const counts = new Map<number, number>();
    for (const submission of submissions) {
        const entityId = submission[key];
        if (submission.type !== "incorrect" || entityId === null || entityId === undefined) {
            continue;
        }
        counts.set(entityId, (counts.get(entityId) ?? 0) + 1);
    }
    return counts;
}

function compareNullableEpochAsc(left: number | null, right: number | null): number {
    if (left === null && right === null) {
        return 0;
    }
    if (left === null) {
        return 1;
    }
    if (right === null) {
        return -1;
    }
    return left - right;
}

function assignRanks(rows: AggregateRow[]): Map<number, number> {
    const sorted = [...rows].sort((left, right) => {
        if (right.total_score !== left.total_score) {
            return right.total_score - left.total_score;
        }
        const lastSolveOrder = compareNullableEpochAsc(left.last_solve_epoch, right.last_solve_epoch);
        if (lastSolveOrder !== 0) {
            return lastSolveOrder;
        }
        return left.entity_id - right.entity_id;
    });

    const ranks = new Map<number, number>();
    let currentRank = 0;
    let previousKey = "";

    for (let index = 0; index < sorted.length; index += 1) {
        const row = sorted[index];
        const currentKey = `${row.total_score}|${row.last_solve_epoch ?? "null"}|${row.entity_id}`;
        if (currentKey !== previousKey) {
            currentRank = index + 1;
            previousKey = currentKey;
        }
        ranks.set(row.entity_id, currentRank);
    }

    return ranks;
}

function applySolveFilters(solves: SolveRow[], params: Record<string, number | string>): SolveRow[] {
    return solves.filter((solve) => {
        if (params.category && solve.category !== params.category) {
            return false;
        }
        if (params.challenge_id && solve.challengeId !== Number(params.challenge_id)) {
            return false;
        }
        if (params.team_id && solve.teamId !== Number(params.team_id)) {
            return false;
        }
        return true;
    });
}

function aggregateEntityRows(entityType: Exclude<EntityType, "solve">, params: Record<string, number | string>, currentDataset: Dataset): AggregateRow[] {
    const filteredSolves = applySolveFilters(currentDataset.correctSolves, params).filter((solve) => {
        if (params.only_first_blood && !solve.isFirstBlood) {
            return false;
        }
        if (params.no_hints && solve.hintUsed) {
            return false;
        }
        return true;
    });

    const awardSums = awardSumByEntity(currentDataset.awards, entityType === "team" ? "team_id" : "user_id");
    const wrongCounts = wrongCountByEntity(currentDataset.submissions, entityType === "team" ? "team_id" : "user_id");
    const baseEntities = entityType === "team" ? currentDataset.teams : currentDataset.users;
    const teamNameById = new Map(currentDataset.teams.map((team) => [team.id, team.name]));

    const rows = baseEntities.map((entity) => {
        const entitySolves = filteredSolves.filter((solve) => entityType === "team" ? solve.teamId === entity.id : solve.userId === entity.id);
        const lastSolveEpoch = entitySolves.reduce<number | null>((latest, solve) => {
            if (latest === null || solve.solveEpochMs > latest) {
                return solve.solveEpochMs;
            }
            return latest;
        }, null);
        const lastSolve = entitySolves.find((solve) => solve.solveEpochMs === lastSolveEpoch)?.solveDate ?? null;

        return {
            entity_id: entity.id,
            entity_name: entity.name,
            bracket_id: entity.bracket_id ?? null,
            team_id: entityType === "user" ? entity.team_id ?? null : undefined,
            team_name: entityType === "user" && entity.team_id ? (teamNameById.get(entity.team_id) ?? null) : undefined,
            solved_count: entitySolves.length,
            total_score: entitySolves.reduce((sum, solve) => sum + solve.challengeValue, 0) + (awardSums.get(entity.id) ?? 0),
            first_blood_count: entitySolves.filter((solve) => solve.isFirstBlood).length,
            category_clear_count: new Set(entitySolves.map((solve) => solve.category)).size,
            perfect_solve_count: entitySolves.filter((solve) => solve.wrongBefore === 0).length,
            wrong_count: wrongCounts.get(entity.id) ?? 0,
            last_solve_date: lastSolve,
            last_solve_epoch: lastSolveEpoch,
        } satisfies AggregateRow;
    });

    const ranks = assignRanks(rows);

    return rows
        .map((row) => ({ ...row, rank: ranks.get(row.entity_id) ?? null }))
        .filter((row) => {
            if (params.bracket_id && row.bracket_id !== Number(params.bracket_id)) {
                return false;
            }
            if (params.min_rank && (row.rank ?? 0) < Number(params.min_rank)) {
                return false;
            }
            if (params.max_rank && (row.rank ?? 0) > Number(params.max_rank)) {
                return false;
            }
            if (params.min_score !== undefined && row.total_score < Number(params.min_score)) {
                return false;
            }
            if (params.max_score !== undefined && row.total_score > Number(params.max_score)) {
                return false;
            }
            if (params.min_count !== undefined && row.first_blood_count < Number(params.min_count)) {
                return false;
            }
            if (params.min_categories_solved !== undefined && row.category_clear_count < Number(params.min_categories_solved)) {
                return false;
            }
            if (params.min_perfect_solves !== undefined && row.perfect_solve_count < Number(params.min_perfect_solves)) {
                return false;
            }
            if (params.min_solves !== undefined && row.solved_count < Number(params.min_solves)) {
                return false;
            }
            return true;
        });
}

function sortByMetric(rows: PreviewResultRow[], direction: "asc" | "desc"): PreviewResultRow[] {
    return [...rows].sort((left, right) => {
        const diff = Number(left.metric_value) - Number(right.metric_value);
        if (diff !== 0) {
            return direction === "desc" ? -diff : diff;
        }
        return left.entity_id - right.entity_id;
    });
}

function computeExpectedResults(templateId: TemplateId, params: Record<string, number | string>, currentDataset: Dataset): PreviewResultRow[] {
    const limit = Number(params.limit ?? 50);

    if (templateId === "top_teams_by_score" || templateId === "teams_by_rank_range" || templateId === "category_specific_top") {
        const rows = aggregateEntityRows("team", params, currentDataset).map((row) => ({
            entity_id: row.entity_id,
            entity_name: row.entity_name,
            metric_value: row.total_score,
            last_solve_date: row.last_solve_date,
            solved_count: row.solved_count,
            rank: row.rank,
        } satisfies PreviewResultRow));
        return sortByMetric(rows, "desc").slice(0, limit);
    }

    if (templateId === "top_users_by_score") {
        const rows = aggregateEntityRows("user", params, currentDataset).map((row) => ({
            entity_id: row.entity_id,
            entity_name: row.entity_name,
            team_name: row.team_name ?? null,
            metric_value: row.total_score,
            last_solve_date: row.last_solve_date,
            solved_count: row.solved_count,
            rank: row.rank,
        } satisfies PreviewResultRow));
        return sortByMetric(rows, "desc").filter((row) => Number(row.metric_value) > 0).slice(0, limit);
    }

    if (templateId === "first_blood_hunters" || templateId === "category_masters" || templateId === "perfect_solvers" || templateId === "solve_count_champions" || templateId === "no_hints_solvers") {
        const entityType = (params.group_by === "user" ? "user" : "team") as Exclude<EntityType, "solve">;
        const rows = aggregateEntityRows(entityType, {
            ...params,
            no_hints: templateId === "no_hints_solvers",
        }, currentDataset).map((row) => {
            let metricValue = row.solved_count;
            if (templateId === "first_blood_hunters") {
                metricValue = row.first_blood_count;
            } else if (templateId === "category_masters") {
                metricValue = row.category_clear_count;
            } else if (templateId === "perfect_solvers") {
                metricValue = row.perfect_solve_count;
            }

            return {
                entity_id: row.entity_id,
                entity_name: row.entity_name,
                team_name: entityType === "user" ? row.team_name ?? null : undefined,
                metric_value: metricValue,
                last_solve_date: row.last_solve_date,
                solved_count: row.solved_count,
                rank: row.rank,
            } satisfies PreviewResultRow;
        });

        const sorted = [...rows].sort((left, right) => {
            const metricDiff = Number(right.metric_value) - Number(left.metric_value);
            if (metricDiff !== 0) {
                return metricDiff;
            }

            const leftRank = Number(left.rank ?? Number.MAX_SAFE_INTEGER);
            const rightRank = Number(right.rank ?? Number.MAX_SAFE_INTEGER);
            if (leftRank !== rightRank) {
                return leftRank - rightRank;
            }

            return left.entity_id - right.entity_id;
        }).slice(0, limit);

        return sorted.map((row, index) => ({
            ...row,
            rank: index + 1,
        }));
    }

    if (templateId === "first_clear_each_category") {
        const entityType = (params.group_by === "user" ? "user" : "team") as Exclude<EntityType, "solve">;
        const baseEntities = entityType === "team" ? currentDataset.teams : currentDataset.users;

        // Build challenge sets per category
        const challengesPerCategory = new Map<string, Set<number>>();
        for (const challenge of currentDataset.challenges) {
            if (!challengesPerCategory.has(challenge.category)) {
                challengesPerCategory.set(challenge.category, new Set());
            }
            challengesPerCategory.get(challenge.category)!.add(challenge.id);
        }

        // For each entity, track earliest solve time per challenge
        const entityChallengeSolveTimes = new Map<number, Map<number, number>>();
        for (const entity of baseEntities) {
            entityChallengeSolveTimes.set(entity.id, new Map());
        }
        for (const solve of currentDataset.correctSolves) {
            const entityId = entityType === "team" ? solve.teamId : solve.userId;
            if (entityId === null || !entityChallengeSolveTimes.has(entityId)) continue;
            const existing = entityChallengeSolveTimes.get(entityId)!.get(solve.challengeId);
            if (existing === undefined || solve.solveEpochMs < existing) {
                entityChallengeSolveTimes.get(entityId)!.set(solve.challengeId, solve.solveEpochMs);
            }
        }

        // For each category, find which entity cleared it first
        const firstClearCount = new Map<number, number>();
        for (const entity of baseEntities) {
            firstClearCount.set(entity.id, 0);
        }
        for (const [, catChallengeIds] of challengesPerCategory.entries()) {
            let firstEntityId: number | null = null;
            let firstClearTime = Infinity;
            for (const entity of baseEntities) {
                const solveTimes = entityChallengeSolveTimes.get(entity.id)!;
                if (![...catChallengeIds].every((cId) => solveTimes.has(cId))) continue;
                const clearTime = Math.max(...[...catChallengeIds].map((cId) => solveTimes.get(cId)!));
                if (clearTime < firstClearTime) {
                    firstClearTime = clearTime;
                    firstEntityId = entity.id;
                }
            }
            if (firstEntityId !== null) {
                firstClearCount.set(firstEntityId, (firstClearCount.get(firstEntityId) ?? 0) + 1);
            }
        }

        const fceRows = aggregateEntityRows(entityType, params, currentDataset).map((row) => ({
            entity_id: row.entity_id,
            entity_name: row.entity_name,
            team_name: entityType === "user" ? (row.team_name ?? null) : undefined,
            metric_value: firstClearCount.get(row.entity_id) ?? 0,
            last_solve_date: row.last_solve_date,
            solved_count: row.solved_count,
            rank: row.rank,
        } satisfies PreviewResultRow));

        return sortByMetric(fceRows, "desc").filter((row) => Number(row.metric_value) > 0).slice(0, limit);
    }

    const teamNameById = new Map(currentDataset.teams.map((team) => [team.id, team.name]));
    const userNameById = new Map(currentDataset.users.map((user) => [user.id, user.name]));
    const teamBracketById = new Map(currentDataset.teams.map((team) => [team.id, team.bracket_id ?? null]));

    const rows = applySolveFilters(currentDataset.correctSolves, params)
        .filter((solve) => {
            if (templateId === "first_blood_by_category" && !solve.isFirstBlood) {
                return false;
            }
            if (params.bracket_id && teamBracketById.get(solve.teamId ?? -1) !== Number(params.bracket_id)) {
                return false;
            }
            return true;
        })
        .map((solve) => ({
            entity_id: solve.solveId,
            entity_name: solve.challengeName,
            category: solve.category,
            metric_value: templateId === "first_blood_by_category" ? 1 : (solve.isFirstBlood ? 1 : 0),
            team_name: solve.teamId ? (teamNameById.get(solve.teamId) ?? null) : null,
            user_name: solve.userId ? (userNameById.get(solve.userId) ?? null) : null,
        } satisfies PreviewResultRow));

    return rows.sort((left, right) => left.entity_id - right.entity_id).slice(0, limit);
}

function normalizePreviewRows(rows: PreviewResultRow[]): Array<Record<string, unknown>> {
    return rows.map((row) => ({
        entity_id: Number(row.entity_id),
        entity_name: row.entity_name,
        category: row.category ?? null,
        team_name: row.team_name ?? null,
        user_name: row.user_name ?? null,
        metric_value: Number(row.metric_value),
        solved_count: row.solved_count ?? null,
        rank: row.rank ?? null,
    }));
}

function getScenario(templateId: TemplateId, currentDataset: Dataset): TemplateScenario {
    switch (templateId) {
        case "top_teams_by_score":
            return { params: { limit: 3 }, entityType: "team", expandable: false };
        case "first_blood_hunters":
            return { params: { limit: 3, min_count: 1 }, entityType: "team", expandable: true };
        case "category_masters":
            return { params: { limit: 3, min_categories_solved: 1 }, entityType: "team", expandable: true };
        case "perfect_solvers":
            return { params: { limit: 3, min_perfect_solves: 1 }, entityType: "team", expandable: true };
        case "solve_count_champions":
            return { params: { limit: 3, min_solves: 1 }, entityType: "team", expandable: true };
        case "first_blood_by_category":
            return { params: { category: currentDataset.primaryCategory }, entityType: "solve", expandable: false };
        case "no_hints_solvers":
            return {
                params: {
                    limit: 3,
                    min_solves: 1,
                    category: currentDataset.primaryCategory,
                },
                entityType: "team",
                expandable: true,
            };
        case "first_clear_each_category":
            return { params: {}, entityType: "team", expandable: false };
    }
}

async function selectTemplate(page: Page, templateId: TemplateId, expectedName: string) {
    await page.goto(`${BASE_URL}/admin/rewards`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForSelector("#template-cards .template-card", { state: "visible", timeout: 15_000 });
    await page.locator(`#template-cards .template-card[data-template-id="${templateId}"]`).click();
    await expect(page.locator("#params-card")).toBeVisible();
    await expect(page.locator("#selected-template-name")).toContainText(expectedName);
}

async function setSearchSelectValue(page: Page, fieldName: "challenge_id" | "team_id", value: number, label: string) {
    await page.evaluate(({ nextFieldName, nextValue, nextLabel }) => {
        const hiddenInput = document.getElementById(`param-${nextFieldName}`) as HTMLInputElement | null;
        const searchInput = document.getElementById(`param-${nextFieldName}-search`) as HTMLInputElement | null;
        if (!hiddenInput || !searchInput) {
            throw new Error(`Cannot find search select for ${nextFieldName}`);
        }
        hiddenInput.value = String(nextValue);
        searchInput.value = nextLabel;
        hiddenInput.dispatchEvent(new Event("input", { bubbles: true }));
        hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
    }, { nextFieldName: fieldName, nextValue: value, nextLabel: label });
}

async function applyScenarioParams(page: Page, scenario: TemplateScenario, currentDataset: Dataset) {
    const challenge = currentDataset.challenges.find((item) => item.id === Number(scenario.params.challenge_id));
    const team = currentDataset.teams.find((item) => item.id === Number(scenario.params.team_id));

    for (const [paramName, paramValue] of Object.entries(scenario.params)) {
        if (paramName === "group_by" || paramName === "category" || paramName === "bracket_id") {
            // skip empty values (category may be "" if dataset has no solves)
            if (paramValue === "" || paramValue === undefined || paramValue === null) {
                continue;
            }
            const selector = `#param-${paramName}`;
            await page.selectOption(selector, String(paramValue));
            continue;
        }

        if (paramName === "challenge_id") {
            await setSearchSelectValue(page, "challenge_id", Number(paramValue), challenge ? `${challenge.name} (${challenge.category})` : String(paramValue));
            continue;
        }

        if (paramName === "team_id") {
            await setSearchSelectValue(page, "team_id", Number(paramValue), team?.name ?? String(paramValue));
            continue;
        }

        await page.fill(`#param-${paramName}`, String(paramValue));
    }
}

async function triggerPreview(page: Page) {
    const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/admin/rewards/preview") && response.request().method() === "POST"
    );
    await page.click("#preview-btn");
    const response = await responsePromise;
    expect(response.ok(), "Preview endpoint phải trả về 2xx").toBeTruthy();
    return await response.json() as { success: boolean; result: PreviewResultRow[] };
}

function getUiColumnKeys(templateId: TemplateId, entityType: EntityType, rows: PreviewResultRow[]): string[] {
    if (entityType === "solve") {
        const solveColumns = ["rank", "entity_name", "category", "team_name"];
        if (templateId !== "first_blood_by_category") {
            solveColumns.push("metric_value");
        }
        return solveColumns.filter((key) => {
            if (key === "category") {
                return rows.some((row) => row.category);
            }
            if (key === "team_name") {
                return rows.some((row) => row.team_name);
            }
            return true;
        });
    }

    if (entityType === "user") {
        const base = ["rank", "entity_id", "entity_name", "team_name", "metric_value"];
        if (templateId === "category_specific_top") {
            base.push("solved_count");
        }
        base.push("last_solve_date");
        return base.filter((key) => {
            if (key === "team_name") {
                return rows.some((row) => row.team_name);
            }
            if (key === "last_solve_date") {
                return rows.some((row) => row.last_solve_date);
            }
            if (key === "solved_count") {
                return rows.some((row) => row.solved_count !== undefined && row.solved_count !== null);
            }
            return true;
        });
    }

    const base = ["rank", "entity_id", "entity_name", "metric_value"];
    if (templateId === "first_clear_each_category") {
        base.push("category");
    }
    base.push("last_solve_date");
    return base.filter((key) => {
        if (key === "category") {
            return rows.some((row) => row.category);
        }
        if (key === "last_solve_date") {
            return rows.some((row) => row.last_solve_date);
        }
        if (key === "solved_count") {
            return rows.some((row) => row.solved_count !== undefined && row.solved_count !== null);
        }
        return true;
    });
}

async function readUiRows(page: Page): Promise<string[][]> {
    return await page.locator("#results-body > tr:not(.detail-row)").evaluateAll((rows) =>
        rows.map((row) => Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()))
    );
}

function assertUiMatchesExpected(uiRows: string[][], expectedRows: PreviewResultRow[], templateId: TemplateId, entityType: EntityType) {
    const columnKeys = getUiColumnKeys(templateId, entityType, expectedRows).filter((key) => key !== "last_solve_date");
    const expectedComparable = expectedRows.map((row, index) => {
        const comparable: Record<string, string | number> = {};
        for (const key of columnKeys) {
            if (key === "rank") {
                comparable[key] = row.rank ?? index + 1;
            } else if (key === "entity_id") {
                comparable[key] = Number(row.entity_id);
            } else if (key === "metric_value") {
                comparable[key] = Number(row.metric_value);
            } else if (key === "solved_count") {
                comparable[key] = Number(row.solved_count ?? 0);
            } else {
                comparable[key] = String((row as Record<string, unknown>)[key] ?? "");
            }
        }
        return comparable;
    });

    const uiComparable = uiRows.map((cells) => {
        const comparable: Record<string, string | number> = {};
        for (let index = 0; index < columnKeys.length; index += 1) {
            const key = columnKeys[index];
            const rawValue = cells[index] ?? "";
            if (key === "rank" || key === "entity_id" || key === "metric_value" || key === "solved_count") {
                comparable[key] = Number(rawValue.replace(/[^\d.-]/g, ""));
            } else {
                comparable[key] = rawValue;
            }
        }
        return comparable;
    });

    expect(uiComparable).toEqual(expectedComparable);
}

async function assertDetailExpansion(page: Page, templateId: TemplateId, entityType: EntityType, firstRow: PreviewResultRow) {
    const responsePromise = page.waitForResponse((response) =>
        response.url().includes("/admin/rewards/details") && response.request().method() === "POST"
    );
    await page.locator("#results-body > tr:not(.detail-row)").first().click();
    const response = await responsePromise;
    expect(response.ok(), "Details endpoint phải trả về 2xx").toBeTruthy();
    const detailJson = await response.json() as {
        success: boolean;
        detail_type?: string;
        details: Array<{
            challenge_name?: string;
            category?: string;
        }>;
    };
    expect(detailJson.success).toBeTruthy();

    const detailRow = page.locator("#results-body > tr.detail-row").first();
    await expect(detailRow).toBeVisible();

    const detailValues = await detailRow.locator("tbody tr td:nth-child(2)").allTextContents();
    if ((detailJson.details ?? []).length > 0) {
        if (detailJson.detail_type === "category_clear") {
            const expectedCategories = detailJson.details.map((detail) => String(detail.category ?? "").trim());
            expect(detailValues.map((value) => value.trim())).toEqual(expectedCategories);
        } else {
            const expectedChallengeNames = detailJson.details.map((detail) => String(detail.challenge_name ?? "").trim());
            expect(detailValues.map((value) => value.trim())).toEqual(expectedChallengeNames);
        }
    }

    const payload = await response.request().postDataJSON() as { template_id: string; entity_type: string; entity_id: number };
    expect(payload.template_id).toBe(templateId);
    expect(payload.entity_type).toBe("team");
    expect(payload.entity_id).toBe(firstRow.entity_id);
}

test.describe.serial("UC-23 Query Reward", () => {
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        dataset = await buildDataset(page);
        await page.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test("TC23.01 - Trang Reward Query hiển thị đủ toàn bộ template live", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/rewards`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#template-cards .template-card", { state: "visible", timeout: 15_000 });

        const liveIds = await page.locator("#template-cards .template-card").evaluateAll((cards) =>
            cards.map((card) => card.getAttribute("data-template-id"))
        );
        const liveNames = await page.locator("#template-cards .template-card h6").allTextContents();

        const expectedIds = TEMPLATE_CASES.map((templateInfo) => templateInfo.id);
        const expectedNames = TEMPLATE_CASES.map((templateInfo) => templateInfo.name);
        const normalizedLiveNames = liveNames.map((name) => name.replace(/^.*?\s/, "").trim());
        const liveTemplateIdsFromApi = dataset.templates.map((templateInfo) => templateInfo.id);

        for (const expectedId of expectedIds) {
            expect(liveIds, `UI thiếu template id: ${expectedId}`).toContain(expectedId);
            expect(liveTemplateIdsFromApi, `API thiếu template id: ${expectedId}`).toContain(expectedId);
        }

        for (const expectedName of expectedNames) {
            expect(normalizedLiveNames, `UI thiếu template name: ${expectedName}`).toContain(expectedName);
        }
    });

    test("TC23.02 - Reset xóa template đang chọn và ẩn preview", async ({ page }) => {
        const templateInfo = TEMPLATE_CASES[0];
        const scenario = getScenario(templateInfo.id, dataset);

        await selectTemplate(page, templateInfo.id, templateInfo.name);
        await applyScenarioParams(page, scenario, dataset);
        await triggerPreview(page);
        await expect(page.locator("#results-card")).toBeVisible();

        await page.click("#reset-btn");

        await expect(page.locator("#params-card")).toBeHidden();
        await expect(page.locator("#results-card")).toBeHidden();
        await expect(page.locator("#template-cards .template-card.selected")).toHaveCount(0);
    });

    // TC23.03 – TC23.13: one test per template
    for (let i = 0; i < TEMPLATE_CASES.length; i++) {
        const templateInfo = TEMPLATE_CASES[i];
        const tcNumber = String(i + 3).padStart(2, "0");

        test(`TC23.${tcNumber} - Preview template "${templateInfo.name}" khớp dữ liệu thật`, async ({ page }) => {
            const scenario = getScenario(templateInfo.id, dataset);

            await selectTemplate(page, templateInfo.id, templateInfo.name);
            await applyScenarioParams(page, scenario, dataset);

            const previewJson = await triggerPreview(page);
            expect(previewJson.success).toBeTruthy();

            const actualRows = (previewJson.result ?? []).map((row) => ({
                ...row,
                metric_value: Number(row.metric_value),
                solved_count: row.solved_count !== undefined && row.solved_count !== null ? Number(row.solved_count) : row.solved_count,
                rank: row.rank !== undefined && row.rank !== null ? Number(row.rank) : row.rank,
            })) as PreviewResultRow[];

            await expect(page.locator("#results-card")).toBeVisible();
            await expect(page.locator("#result-count")).toContainText(`${actualRows.length} results`);
            await expect(page.locator("#stat-count")).toHaveText(String(actualRows.length));

            const uiRows = await readUiRows(page);
            expect(uiRows.length).toBe(actualRows.length);
            assertUiMatchesExpected(uiRows, actualRows, templateInfo.id, scenario.entityType);

            if (templateInfo.expandable && actualRows.length > 0) {
                await assertDetailExpansion(page, templateInfo.id, scenario.entityType, actualRows[0]);
            }
        });
    }

    test("TC23.14 - Export Excel: bấm button Export phải hiển thị pop-up chọn folder và tải file", async ({ page }) => {
        const templateInfo = TEMPLATE_CASES[0];
        const scenario = getScenario(templateInfo.id, dataset);

        await selectTemplate(page, templateInfo.id, templateInfo.name);
        await applyScenarioParams(page, scenario, dataset);
        await triggerPreview(page);

        await expect(page.locator("#results-card")).toBeVisible();
        const exportBtn = page.locator('#export-csv-btn, button:has-text("Export"), a:has-text("Export")');
        await expect(exportBtn.first()).toBeVisible();

        const downloadPromise = page.waitForEvent("download");
        await exportBtn.first().click();
        const download = await downloadPromise;

        const filename = download.suggestedFilename();
        expect(filename).toMatch(/\.(csv|xlsx?)$/i);
    });

    test("TC23.15 - Chọn template → params card hiển thị, chưa chọn → params ẩn", async ({ page }) => {
        await page.goto(`${BASE_URL}/admin/rewards`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#template-cards .template-card", { state: "visible", timeout: 15_000 });

        // Trước khi chọn template, params phải ẩn
        await expect(page.locator("#params-card")).toBeHidden();

        // Chọn template đầu tiên → params hiển thị
        const templateInfo = TEMPLATE_CASES[0];
        await selectTemplate(page, templateInfo.id, templateInfo.name);
        await expect(page.locator("#params-card")).toBeVisible();
    });
});