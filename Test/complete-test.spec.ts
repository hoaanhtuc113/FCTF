import { test, expect, Page } from '@playwright/test';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface Choice {
    text: string;
    correct: boolean;
}

interface ExpectedError {
    field: string;
    message: string;
}

interface BaseTestData {
    testCaseName: string;
    name: string;
    category: string;
    description: string;
    pdfFile: string;
    timeLimit: string;
    maxAttempts: string;
    cooldown: string;
    setUpDocker: boolean;
    state: string;
    shouldFail: boolean;
}

interface StandardChallengeData extends BaseTestData {
    points: string;
    flag: string;
    deployStatus?: string;
    expectedError?: ExpectedError;
}

interface DockerChallengeData extends StandardChallengeData {
    port?: string;
    cpuLimit?: string;
    memoryLimit?: string;
    useGvisor?: string;
    deployFile?: string;
}

interface DynamicChallengeData extends BaseTestData {
    challengeType: 'dynamic';
    initialValue: string;
    minimumValue: string;
    decayFactor: string;
    flag: string;
    deployStatus?: string;
    expectedError?: ExpectedError;
}

interface MultipleChoiceData extends BaseTestData {
    challengeType: 'multiple_choice';
    points: string;
    choices: Choice[];
    flag?: string; // Correct answer as flag
    deployStatus?: string;
    expectedError?: ExpectedError;
}

type TestData = StandardChallengeData | DockerChallengeData | DynamicChallengeData | MultipleChoiceData;

// =============================================================================
// PHẦN 1: BỘ DỮ LIỆU TEST CASES
// =============================================================================

// ========== SUCCESS TEST CASES ==========

// Standard Challenges - Success
const standardSuccessData: TestData[] = [
    {
        testCaseName: 'TC-001: Web challenge + Docker deployment',
        name: 'Success_Web_Docker',
        category: 'web',
        description: 'Đây là challenge web có docker deployment',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test_web_docker}',
        setUpDocker: true,
        port: '8080',
        cpuLimit: '300',
        memoryLimit: '256',
        useGvisor: 'false',
        deployFile: 'EZ_WEB.zip',
        deployStatus: 'DEPLOY_SUCCESS',
        state: 'visible',
        shouldFail: false
    },
    {
        testCaseName: 'TC-002: PWN challenge với unlimited attempts',
        name: 'Success_Pwn_Unlimited',
        category: 'pwn',
        description: 'Challenge pwn không giới hạn số lần thử',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '25',
        maxAttempts: '0',
        cooldown: '0',
        points: '200',
        flag: 'FCTF{test_pwn_unlimited}',
        setUpDocker: false,
        deployStatus: 'CREATED',
        state: 'hidden',
        shouldFail: false
    },
    {
        testCaseName: 'TC-003: Crypto challenge file-only',
        name: 'Success_Crypto_FileOnly',
        category: 'crypto',
        description: 'Challenge crypto chỉ có file đính kèm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '10',
        cooldown: '3',
        points: '150',
        flag: 'FCTF{test_crypto_file}',
        setUpDocker: false,
        deployStatus: 'CREATED',
        state: 'visible',
        shouldFail: false
    },
    {
        testCaseName: 'TC-004: Forensics với time limit 30 phút',
        name: 'Success_Forensics_LongTime',
        category: 'forensics',
        description: 'Challenge forensics với time limit tối đa',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '3',
        cooldown: '10',
        points: '300',
        flag: 'FCTF{test_forensics_long}',
        setUpDocker: false,
        deployStatus: 'CREATED',
        state: 'visible',
        shouldFail: false
    },
    {
        testCaseName: 'TC-005: Reverse Engineering với Docker + gVisor',
        name: 'Success_Rev_Gvisor',
        category: 'reverse',
        description: 'Challenge reverse engineering với gVisor enabled',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '20',
        maxAttempts: '5',
        cooldown: '5',
        points: '250',
        flag: 'FCTF{test_rev_gvisor}',
        setUpDocker: true,
        port: '9000',
        cpuLimit: '500',
        memoryLimit: '512',
        useGvisor: 'true',
        deployFile: 'EZ_WEB.zip',
        deployStatus: 'DEPLOY_SUCCESS',
        state: 'visible',
        shouldFail: false
    }
];

// Dynamic Challenges - Success
const dynamicSuccessData: DynamicChallengeData[] = [
    {
        testCaseName: 'TC-006: Dynamic challenge với decay cao',
        name: 'Success_Dynamic_HighDecay',
        category: 'web',
        description: 'Challenge dynamic với điểm giảm nhanh',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        challengeType: 'dynamic',
        initialValue: '500',
        minimumValue: '100',
        decayFactor: '50',
        flag: 'FCTF{test_dynamic_high}',
        setUpDocker: false,
        deployStatus: 'CREATED',
        state: 'visible',
        shouldFail: false
    },
    {
        testCaseName: 'TC-007: Dynamic challenge với decay thấp',
        name: 'Success_Dynamic_LowDecay',
        category: 'misc',
        description: 'Challenge dynamic với điểm giảm chậm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '25',
        maxAttempts: '10',
        cooldown: '3',
        challengeType: 'dynamic',
        initialValue: '1000',
        minimumValue: '200',
        decayFactor: '10',
        flag: 'FCTF{test_dynamic_low}',
        setUpDocker: false,
        deployStatus: 'CREATED',
        state: 'hidden',
        shouldFail: false
    },
    {
        testCaseName: 'TC-008: Dynamic challenge với minimum = 0',
        name: 'Success_Dynamic_MinZero',
        category: 'crypto',
        description: 'Challenge dynamic với minimum value = 0',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '20',
        maxAttempts: '5',
        cooldown: '2',
        challengeType: 'dynamic',
        initialValue: '300',
        minimumValue: '0',
        decayFactor: '25',
        flag: 'FCTF{test_dynamic_min_zero}',
        setUpDocker: false,
        deployStatus: 'CREATED',
        state: 'visible',
        shouldFail: false
    }
];

// Multiple Choice Challenges - Success
const multipleChoiceSuccessData: MultipleChoiceData[] = [
    {
        testCaseName: 'TC-009: Multiple Choice với 4 lựa chọn',
        name: 'Success_MC_4Choices',
        category: 'misc',
        description: 'Challenge multiple choice cơ bản',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '15',
        maxAttempts: '3',
        cooldown: '2',
        points: '50',
        challengeType: 'multiple_choice',
        choices: [
            { text: 'Đáp án A - Sai', correct: false },
            { text: 'Đáp án B - Đúng', correct: true },
            { text: 'Đáp án C - Sai', correct: false },
            { text: 'Đáp án D - Sai', correct: false }
        ],
        flag: 'Đáp án B - Đúng', // Correct answer as flag
        setUpDocker: false,
        deployStatus: 'CREATED',
        state: 'visible',
        shouldFail: false
    }
];

// ========== VALIDATION ERROR TEST CASES ==========

// Time Limit Errors
const timeLimitErrorData: TestData[] = [
    {
        testCaseName: 'TC-101: Time limit âm',
        name: 'Error_TimeLimit_Negative',
        category: 'web',
        description: 'Test lỗi time limit âm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '-5',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'timeLimit',
            message: 'greater than or equal to'
        }
    },
    {
        testCaseName: 'TC-102: Time limit = 0',
        name: 'Error_TimeLimit_Zero',
        category: 'web',
        description: 'Test lỗi time limit bằng 0',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '0',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'timeLimit',
            message: 'greater than or equal to'
        }
    }
];

// Max Attempts Errors
const maxAttemptsErrorData: TestData[] = [
    {
        testCaseName: 'TC-201: Max attempts = -2 (không hợp lệ)',
        name: 'Error_MaxAttempts_Invalid',
        category: 'web',
        description: 'Test lỗi max attempts không hợp lệ',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '-2',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'maxAttempts',
            message: 'greater than or equal to'
        }
    }
];

// Cooldown Errors
const cooldownErrorData: TestData[] = [
    {
        testCaseName: 'TC-301: Cooldown âm',
        name: 'Error_Cooldown_Negative',
        category: 'web',
        description: 'Test lỗi cooldown âm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '-10',
        points: '100',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'cooldown',
            message: 'greater than or equal to'
        }
    }
];

// Points Errors
const pointsErrorData: TestData[] = [
    {
        testCaseName: 'TC-401: Points âm',
        name: 'Error_Points_Negative',
        category: 'web',
        description: 'Test lỗi points âm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '-50',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'points',
            message: 'greater than or equal to'
        }
    },
    {
        testCaseName: 'TC-402: Points = 0',
        name: 'Points_Zero',
        category: 'web',
        description: 'Test points bằng 0',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '0',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: false
    }
];

// Required Fields Errors
const requiredFieldsErrorData: TestData[] = [
    {
        testCaseName: 'TC-501: Thiếu tên challenge',
        name: '',
        category: 'web',
        description: 'Test lỗi thiếu tên',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'name',
            message: 'Please fill out this field.'
        }
    },
    {
        testCaseName: 'TC-502: Thiếu category',
        name: 'Error_Missing_Category',
        category: '',
        description: 'Test lỗi thiếu category',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'category',
            message: 'Please fill out this field.'
        }
    },
    {
        testCaseName: 'TC-503: Category maxLength constraint (>20 ký tự)',
        name: 'Success_Category_MaxLength',
        category: 'ThisCategoryIsWayTooLongForTheSystem', // 39 chars, but only 20 will be kept
        description: 'Test maxLength constraint - chỉ giữ 20 ký tự đầu',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test_maxlength}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: false // Đây là success case - frontend sẽ tự cắt về 20 ký tự
    },
    {
        testCaseName: 'TC-504: Challenge name maxLength constraint (>100 ký tự)',
        name: 'ThisIsAVeryLongChallengeNameThatExceedsTheMaximumLengthAllowedByTheFrontendInputFieldConstraintAndShouldBeTruncated', // 115 chars
        category: 'web',
        description: 'Test maxLength constraint cho challenge name - chỉ giữ tối đa ký tự cho phép',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test_name_maxlength}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: false // Đây là success case - frontend sẽ tự cắt name về maxLength
    }
];

// Dynamic Challenge Errors
const dynamicErrorData: DynamicChallengeData[] = [
    {
        testCaseName: 'TC-801: Dynamic - Initial value < Minimum value',
        name: 'Error_Dynamic_InitialLessThanMin',
        category: 'web',
        description: 'Test lỗi initial value nhỏ hơn minimum',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        challengeType: 'dynamic',
        initialValue: '50',
        minimumValue: '100',
        decayFactor: '10',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'initialValue',
            message: 'greater than minimum'
        }
    },
    {
        testCaseName: 'TC-802: Dynamic - Decay factor = 0',
        name: 'Error_Dynamic_DecayZero',
        category: 'web',
        description: 'Test lỗi decay factor bằng 0',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        challengeType: 'dynamic',
        initialValue: '500',
        minimumValue: '100',
        decayFactor: '0',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'decayFactor',
            message: 'greater than 0'
        }
    },
    {
        testCaseName: 'TC-803: Dynamic - Minimum value âm',
        name: 'Error_Dynamic_MinNegative',
        category: 'web',
        description: 'Test lỗi minimum value âm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        challengeType: 'dynamic',
        initialValue: '500',
        minimumValue: '-10',
        decayFactor: '50',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'minimumValue',
            message: 'greater than or equal to'
        }
    },
    {
        testCaseName: 'TC-804: Dynamic - Decay factor âm',
        name: 'Error_Dynamic_DecayNegative',
        category: 'web',
        description: 'Test lỗi decay factor âm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        challengeType: 'dynamic',
        initialValue: '500',
        minimumValue: '100',
        decayFactor: '-20',
        flag: 'FCTF{test}',
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'decayFactor',
            message: 'greater than 0'
        }
    }
];

// Multiple Choice Errors
const multipleChoiceErrorData: MultipleChoiceData[] = [
    {
        testCaseName: 'TC-901: Multiple Choice - Không có đáp án đúng',
        name: 'Error_MC_NoCorrectAnswer',
        category: 'misc',
        description: 'Test lỗi không có đáp án đúng',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '15',
        maxAttempts: '3',
        cooldown: '2',
        points: '50',
        challengeType: 'multiple_choice',
        choices: [
            { text: 'Đáp án A', correct: false },
            { text: 'Đáp án B', correct: false },
            { text: 'Đáp án C', correct: false },
            { text: 'Đáp án D', correct: false }
        ],
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'choices',
            message: 'at least one correct answer'
        }
    },
    {
        testCaseName: 'TC-902: Multiple Choice - Quá ít lựa chọn (<2)',
        name: 'Error_MC_TooFewChoices',
        category: 'misc',
        description: 'Test lỗi chỉ có 1 lựa chọn',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '15',
        maxAttempts: '3',
        cooldown: '2',
        points: '50',
        challengeType: 'multiple_choice',
        choices: [
            { text: 'Đáp án duy nhất', correct: true }
        ],
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'choices',
            message: 'at least 2 choices'
        }
    },
    {
        testCaseName: 'TC-903: Multiple Choice - Lựa chọn trống',
        name: 'Error_MC_EmptyChoice',
        category: 'misc',
        description: 'Test lỗi có lựa chọn không có text',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '15',
        maxAttempts: '3',
        cooldown: '2',
        points: '50',
        challengeType: 'multiple_choice',
        choices: [
            { text: '', correct: false },
            { text: 'Đáp án B', correct: true },
            { text: 'Đáp án C', correct: false }
        ],
        setUpDocker: false,
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'choices',
            message: 'empty choice'
        }
    }
];

// Docker Configuration Errors
const dockerErrorData: DockerChallengeData[] = [
    {
        testCaseName: 'TC-601: Port âm',
        name: 'Error_Port_Negative',
        category: 'web',
        description: 'Test lỗi port âm',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test}',
        setUpDocker: true,
        port: '-80',
        cpuLimit: '300',
        memoryLimit: '256',
        useGvisor: 'false',
        deployFile: 'EZ_WEB.zip',
        state: 'visible',
        shouldFail: true,
        expectedError: {
            field: 'port',
            message: 'positive integer'
        }
    },
    {
        testCaseName: 'TC-602: Port = 0 (Success)',
        name: 'Success_Port_Zero',
        category: 'web',
        description: 'Test port = 0 (hợp lệ - random port)',
        pdfFile: 'Huong_dan_KTXH_tren_EduNext_Sp23_Sinh_Vien.pdf',
        timeLimit: '30',
        maxAttempts: '5',
        cooldown: '5',
        points: '100',
        flag: 'FCTF{test_port_zero}',
        setUpDocker: true,
        port: '0',
        cpuLimit: '300',
        memoryLimit: '256',
        useGvisor: 'false',
        deployFile: 'EZ_WEB.zip',
        state: 'visible',
        shouldFail: false,
        deployStatus: 'DEPLOY_SUCCESS'
    }
];

// Gộp tất cả test data
const allTestData: TestData[] = [
    ...standardSuccessData,
    ...dynamicSuccessData,
    ...multipleChoiceSuccessData,
    ...timeLimitErrorData,
    ...maxAttemptsErrorData,
    ...cooldownErrorData,
    ...pointsErrorData,
    ...requiredFieldsErrorData,
    ...dynamicErrorData,
    ...multipleChoiceErrorData,
    ...dockerErrorData
];

// =============================================================================
// PHẦN 2: HELPER FUNCTIONS
// =============================================================================

// Helper: Điền form challenge với dữ liệu
async function fillChallengeForm(page: Page, data: TestData, finalName: string) {
    await test.step('Fill Challenge Form', async () => {
        // Basic Info
        if (data.name !== undefined) {
            await page.getByRole('textbox', { name: 'Enter challenge name' }).fill(finalName);
        }

        if (data.category !== undefined) {
            await page.getByRole('textbox', { name: 'Enter challenge category' }).fill(data.category);
        }

        if (data.pdfFile) {
            // Multiple Choice không có nút Choose File, chỉ Standard/Dynamic mới có
            const isMultipleChoice = 'challengeType' in data && data.challengeType === 'multiple_choice';
            if (!isMultipleChoice) {
                await page.getByRole('button', { name: 'Choose File' }).first().setInputFiles(data.pdfFile);
            }
        }

        if (data.description !== undefined) {
            let descriptionToFill = data.description;

            // Nếu là Multiple Choice, thêm format options vào description
            // Syntax: *() Choice Text (KHÔNG có khoảng trắng giữa * và ())
            if ('challengeType' in data && data.challengeType === 'multiple_choice') {
                const mcData = data as MultipleChoiceData;
                if (mcData.choices && mcData.choices.length > 0) {
                    descriptionToFill += '\n'; // Xuống dòng
                    mcData.choices.forEach(choice => {
                        descriptionToFill += `*() ${choice.text}\n`;
                    });
                }
            }

            // Điền vào EasyMDE editor (Role application -> textbox)
            await page.getByRole('application').getByRole('textbox').fill(descriptionToFill);
        }

        // Time & Attempts
        if (data.timeLimit !== undefined) {
            await page.locator('input[name="time_limit"]').fill(data.timeLimit);
        }

        if (data.maxAttempts !== undefined) {
            await page.locator('input[name="max_attempts"]').fill(data.maxAttempts);
        }

        if (data.cooldown !== undefined) {
            await page.getByRole('spinbutton', { name: 'Submission cooldown' }).fill(data.cooldown);
        }

        if ('points' in data && data.points !== undefined) {
            await page.locator('input[name="value"]').fill(data.points);
        }

        // Dynamic Challenge Fields
        if ('challengeType' in data && data.challengeType === 'dynamic') {
            if ('initialValue' in data && data.initialValue !== undefined) {
                await page.locator('input[name="initial"]').fill(data.initialValue);
            }
            if ('minimumValue' in data && data.minimumValue !== undefined) {
                await page.locator('input[name="minimum"]').fill(data.minimumValue);
            }
            if ('decayFactor' in data && data.decayFactor !== undefined) {
                await page.locator('input[name="decay"]').fill(data.decayFactor);
            }
        }
    });
}

// Helper: Cấu hình Docker
async function setupDockerConfig(page: Page, data: TestData) {
    await test.step('Setup Docker Configuration', async () => {
        await page.getByText('Setup Docker').click();
        await page.waitForTimeout(500);

        if ('port' in data && data.port !== undefined) {
            await page.locator('#expose_port').fill(data.port);
        }

        if ('cpuLimit' in data && data.cpuLimit !== undefined) {
            await page.locator('input[name="cpu_limit"]').fill(data.cpuLimit);
        }

        if ('memoryLimit' in data && data.memoryLimit !== undefined) {
            await page.locator('input[name="memory_limit"]').fill(data.memoryLimit);
        }

        if ('useGvisor' in data && data.useGvisor !== undefined) {
            await page.locator('select[name="use_gvisor"]').selectOption(data.useGvisor);
        }

        if ('deployFile' in data && data.deployFile) {
            await page.locator('input[name="deploy_file"]').setInputFiles(data.deployFile);
        }
    });
}

// Helper: Kiểm tra validation error
async function checkValidationError(page: Page, data: TestData): Promise<boolean> {
    if (!data.expectedError) return false;

    const fieldMap: Record<string, any> = {
        'timeLimit': page.locator('input[name="time_limit"]'),
        'maxAttempts': page.locator('input[name="max_attempts"]'),
        'cooldown': page.getByRole('spinbutton', { name: 'Submission cooldown' }),
        'points': page.locator('input[name="value"]'),
        'name': page.getByRole('textbox', { name: 'Enter challenge name' }),
        'category': page.getByRole('textbox', { name: 'Enter challenge category' })
    };

    const field = fieldMap[data.expectedError.field];
    if (!field) {
        return false;
    }

    try {
        // Kiểm tra HTML5 validation
        const validationMessage = await field.evaluate((node: any) => {
            if (node.validationMessage) {
                return node.validationMessage;
            }
            return '';
        });

        if (validationMessage && validationMessage.length > 0) {
            const messageContainsError = validationMessage.toLowerCase().includes(data.expectedError.message.toLowerCase());
            if (messageContainsError) {
                return true;
            }
        }

        // Kiểm tra backend error (modal/alert)
        const backendError = await checkErrorMessage(page, data.expectedError.message);
        if (backendError) {
            return true;
        }

        return false;
    } catch (error) {
        throw error;
    }
}

// Helper: Kiểm tra error message từ backend
async function checkErrorMessage(page: Page, expectedMessage: string): Promise<boolean> {
    try {
        // Kiểm tra modal
        const modal = page.locator('.ez-alert-modal, .modal-dialog, [role="dialog"]');
        const modalVisible = await modal.isVisible().catch(() => false);

        if (modalVisible) {
            const modalText = await modal.textContent();
            if (modalText?.toLowerCase().includes(expectedMessage.toLowerCase())) {
                return true;
            }
        }

        return false;
    } catch (error) {
        return false;
    }
}

// Helper: Tìm challenge với pagination support
async function findChallengeWithPagination(page: Page, challengeName: string, maxPages: number = 5): Promise<boolean> {
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
        // Cuộn xuống cuối container #content (nơi chứa bảng) để trigger lazy load
        // Dựa trên CSS: #content { overflow-y: auto; }
        await page.evaluate(() => {
            const content = document.querySelector('#content');
            if (content) {
                content.scrollTo(0, content.scrollHeight);
            } else {
                window.scrollTo(0, document.body.scrollHeight);
            }
        });

        // Thêm thao tác chuột vào vùng content (tránh sidebar < 280px) để chắc chắn
        try {
            await page.mouse.move(500, 500);
            await page.mouse.wheel(0, 5000);
        } catch (e) {
            // Ignore error if mouse move fails
        }

        await page.waitForTimeout(1000); // Đợi nội dung load

        // Kiểm tra xem challenge có trên trang hiện tại không
        const challengeRow = page.locator('tr', { hasText: challengeName });
        if (await challengeRow.count() > 0) {
            await challengeRow.first().scrollIntoViewIfNeeded();
            return true;
        }

        // Nếu chưa tìm thấy và chưa phải trang cuối, tìm nút Next để chuyển trang
        if (pageNum < maxPages) {
            // Thử danh sách các selector phổ biến cho nút Next (Bootstrap, Custom, Icon)
            // Cập nhật: Thêm selector cho ký tự » (right angle quotes)
            const nextSelectors = [
                'a.page-link:has-text("»")',
                'li.page-item:not(.disabled) [aria-label="Next"]',
                'li.page-item:not(.disabled) [rel="next"]',
                'button:has-text(">")',
                'a:has-text(">")',
                '.pagination .next a',
                '[class*="pagination"] [class*="next"]'
            ];

            let navigated = false;
            for (const selector of nextSelectors) {
                const nextBtn = page.locator(selector).first();
                if (await nextBtn.isVisible()) {
                    await nextBtn.click();
                    await page.waitForTimeout(2000); // Đợi load trang mới
                    navigated = true;
                    break;
                }
            }

            // Nếu không tìm thấy nút next hoạt động -> có thể đã hết trang
            if (!navigated) {
                break;
            }
        }
    }
    return false;
}

// =============================================================================
// PHẦN 3: TEST SUITE
// =============================================================================

test.describe('Test Suite: Tạo Challenge - Validation Đầy Đủ', () => {

    // Login trước mỗi test
    test.beforeEach(async ({ page }: { page: Page }) => {
        await page.goto('https://admin.fctf.site/login');
        await page.getByRole('textbox', { name: 'User Name or Email' }).fill('admin');
        await page.getByRole('textbox', { name: 'Password' }).fill('1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page).toHaveURL(/.*admin/);
    });

    // Chạy test cho từng bộ dữ liệu
    for (const data of allTestData) {
        test(`${data.testCaseName}`, async ({ page }: { page: Page }) => {
            test.setTimeout(180000); // 3 minutes timeout

            let finalName = `${data.name}_${Date.now()}`;
            if (data.name === '' || data.name === null) {
                finalName = data.name;
            }
            // TC-504: Giữ nguyên tên dài để test maxLength constraint
            if (data.testCaseName.includes('TC-504')) {
                finalName = data.name;
            }

            try {
                // BƯỚC 1: Vào trang tạo challenge
                await page.getByRole('link', { name: '+ Create Challenge' }).click();
                await page.waitForTimeout(1000);

                // BƯỚC 2: Chọn challenge type nếu cần
                if ('challengeType' in data && data.challengeType) {
                    // Click vào challenge type - tìm label chính xác và click
                    // hasText với exact sẽ tránh match cả "Dynamic Reward Query"
                    const challengeTypeLabel = page.locator('.form-check-label').filter({ hasText: new RegExp(`^${data.challengeType}$`, 'i') });
                    await challengeTypeLabel.click();
                    await page.waitForTimeout(1000);
                }

                // BƯỚC 3: Điền form
                await fillChallengeForm(page, data, finalName);

                // BƯỚC 4: Click Create để trigger validation
                await page.getByRole('button', { name: 'Create', exact: true }).click();

                // Đợi một chút để form xử lý
                await page.waitForTimeout(1000);

                // BƯỚC 5: Kiểm tra lỗi nếu shouldFail = true
                if (data.shouldFail) {
                    const hasError = await checkValidationError(page, data);

                    if (hasError) {
                        return; // Test passed - đã bắt được lỗi
                    } else {
                        throw new Error(`Expected validation error for field "${data.expectedError?.field}" but none found`);
                    }
                }

                // BƯỚC 6: Nếu không có lỗi, đợi form chuyển sang bước tiếp theo
                // Kiểm tra xem flag input có xuất hiện không (nghĩa là form đã chuyển sang bước 2)
                await page.waitForSelector('input[name="flag"], button:has-text("Finish")', { timeout: 10000 });

                // BƯỚC 7: Cấu hình Docker nếu cần
                if (data.setUpDocker) {
                    await setupDockerConfig(page, data);
                }

                // Điền flag (Cho cả Multiple Choice vì nó cần flag là đáp án đúng)
                if ('flag' in data && data.flag !== undefined) {
                    const flagInput = page.locator('input[name="flag"]');
                    await flagInput.waitFor({ state: 'visible', timeout: 5000 });
                    await flagInput.fill(data.flag);
                }

                if (data.state) {
                    await page.locator('select[name="state"]').selectOption(data.state);
                }

                // BƯỚC 8: Click Finish
                await page.getByRole('button', { name: 'Finish' }).click();

                // ⏰ QUAN TRỌNG: Nếu có Docker deployment, chờ 2 phút để deployment hoàn thành
                if (data.setUpDocker || ('deployStatus' in data && data.deployStatus === 'DEPLOY_SUCCESS')) {
                    await page.waitForTimeout(120000); // 2 phút = 120000ms
                } else {
                    await page.waitForTimeout(2000);
                }

                // BƯỚC 9: Verify challenge được tạo thành công
                await page.getByRole('link', { name: ' Challenges' }).click();
                await page.waitForTimeout(2000);

                // 🔍 Tìm challenge với pagination support
                const challengeRow = page.locator('tr', { hasText: finalName });

                await expect(async () => {
                    await page.reload();
                    await page.waitForTimeout(1000);

                    // Tìm challenge qua nhiều trang nếu cần
                    // TC-504: Sử dụng substring vì tên bị truncate
                    const searchName = data.testCaseName.includes('TC-504')
                        ? finalName.substring(0, 40)  // Tìm theo 40 ký tự đầu
                        : finalName;

                    const found = await findChallengeWithPagination(page, searchName, 5);
                    expect(found).toBeTruthy();

                    // Verify các thông tin
                    // TC-503/TC-504: Có thể có nhiều rows với tên/category giống nhau, lấy row mới nhất
                    const row = (data.testCaseName.includes('TC-503') || data.testCaseName.includes('TC-504'))
                        ? page.locator('tr', { hasText: searchName }).last()
                        : page.locator('tr', { hasText: searchName });

                    // TC-504: Skip name check vì name sẽ bị truncate
                    if (!data.testCaseName.includes('TC-504')) {
                        await expect(row).toContainText(finalName);
                    }

                    // TC-503: Skip category check vì category sẽ bị truncate
                    if (!data.testCaseName.includes('TC-503')) {
                        await expect(row).toContainText(data.category);
                    }

                    await expect(row).toContainText(data.state);

                    // Verify points
                    if ('points' in data && data.points) {
                        await expect(row).toContainText(data.points);
                    }

                    // Verify deploy status nếu có
                    if ('deployStatus' in data && data.deployStatus) {
                        await expect(row).toContainText(data.deployStatus);
                    }

                    // BƯỚC 9.5: Verify maxLength constraints cho TC-503 và TC-504
                    if (data.testCaseName.includes('TC-503')) {
                        // Category cell có class 'text-center text-wrap'
                        const categoryCell = row.locator('td.text-wrap').first();
                        const actualCategory = await categoryCell.textContent();
                        const actualLength = actualCategory?.trim().length || 0;

                        if (actualLength > 20) {
                            throw new Error(`TC-503 Failed: Category in table has ${actualLength} chars, expected max 20. Value: "${actualCategory?.trim()}"`);
                        }

                        console.log(`✓ TC-503 Verification: Category "${actualCategory?.trim()}" has ${actualLength}/20 chars - PASS`);
                    }

                    if (data.testCaseName.includes('TC-504')) {
                        // Name nằm trong thẻ <a> bên trong <td cllass="text-center text-wrap">
                        // Tìm <a> chứa challenge name (cột thứ 2, row đã filter theo finalName)
                        const nameLink = row.locator('td a').first();
                        const actualName = await nameLink.textContent();
                        const actualLength = actualName?.trim().length || 0;


                        const expectedMaxLength = 40; // Conservative estimate

                        if (actualLength > expectedMaxLength) {
                            throw new Error(`TC-504 Failed: Name in table has ${actualLength} chars, expected max ${expectedMaxLength}. Value: "${actualName?.trim()}"`);
                        }

                        console.log(`✓ TC-504 Verification: Name "${actualName?.trim()}" has ${actualLength}/${expectedMaxLength} chars - PASS`);
                    }

                    console.log(`✅ Challenge created successfully!`);
                }).toPass({
                    intervals: [10000],
                    timeout: 180000
                });

            } catch (error) {
                console.error(`❌ Test failed:`, error);

                // Screenshot khi lỗi
                await page.screenshot({
                    path: `test-results/error-${data.testCaseName}-${Date.now()}.png`,
                    fullPage: true
                });

                throw error;
            }
        });
    }
});