-- FAQ in three languages, with categories and chat buttons (Story 12).
-- question/answer stay the English text (and keep the UNIQUE that the seed in
-- 001_init.sql relies on); the Kazakh and Russian texts sit next to them.
-- pinned = shown as an instant-answer button in the AI chat.
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS question_kz TEXT NOT NULL DEFAULT '';
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS question_ru TEXT NOT NULL DEFAULT '';
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS answer_kz   TEXT NOT NULL DEFAULT '';
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS answer_ru   TEXT NOT NULL DEFAULT '';
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS category    TEXT NOT NULL DEFAULT 'general';
-- Entries that existed before this change start as chat buttons (the old
-- chat showed them all); new ones don't until an admin pins them. On later
-- starts ADD COLUMN IF NOT EXISTS does nothing, so admin choices are kept.
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE faqs ALTER COLUMN pinned SET DEFAULT false;

DO $$ BEGIN
    ALTER TABLE faqs ADD CONSTRAINT faqs_category_check
        CHECK (category IN ('general', 'account', 'study', 'campus', 'forum'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Translations and categories for the seeded entries; only fills texts that
-- are still empty, so edits made in the admin panel are never overwritten.
UPDATE faqs f SET
    question_kz = CASE WHEN f.question_kz = '' THEN v.question_kz ELSE f.question_kz END,
    question_ru = CASE WHEN f.question_ru = '' THEN v.question_ru ELSE f.question_ru END,
    answer_kz   = CASE WHEN f.answer_kz   = '' THEN v.answer_kz   ELSE f.answer_kz   END,
    answer_ru   = CASE WHEN f.answer_ru   = '' THEN v.answer_ru   ELSE f.answer_ru   END,
    category    = CASE WHEN f.question_kz = '' THEN v.category    ELSE f.category    END
FROM (VALUES
    ('What is SDU Helpdesk?', 'general',
     'SDU Helpdesk деген не?',
     'SDU Helpdesk — SDU студенттеріне арналған көмек платформасы. AI көмекшіге сұрақ қойыңыз, оны форумда басқа студенттермен талқылаңыз, кампустан аудиториялар мен ғимараттарды табыңыз, курс сипаттамалары мен студенттер пікірлерін оқыңыз — бәрі бір жерде.',
     'Что такое SDU Helpdesk?',
     'SDU Helpdesk — платформа помощи для студентов SDU. Задайте вопрос AI-помощнику, обсудите его с другими студентами на форуме, найдите аудитории и корпуса кампуса, читайте описания курсов и отзывы студентов — всё в одном месте.'),
    ('Who can use SDU Helpdesk?', 'account',
     'SDU Helpdesk-ті кім қолдана алады?',
     'Университеттік поштасы (@sdu.edu.kz) бар кез келген SDU студенті. Университеттік поштаңызбен тіркеліп, біз жіберген 6 таңбалы кодпен оны растаңыз.',
     'Кто может пользоваться SDU Helpdesk?',
     'Любой студент SDU с университетской почтой (@sdu.edu.kz). Зарегистрируйтесь с университетской почтой и подтвердите её 6-значным кодом, который мы пришлём.'),
    ('How do I ask a question on the forum?', 'forum',
     'Форумда қалай сұрақ қоямын?',
     '«Форум» бөлімін ашып, «Жаңа сұрақ» батырмасын басыңыз. Қысқа тақырып жазып, сұрағыңызды толық сипаттаңыз — басқа студенттер оған жауап бере алады.',
     'Как задать вопрос на форуме?',
     'Откройте «Форум» и нажмите «Новый вопрос». Напишите короткий заголовок и подробно опишите вопрос — другие студенты смогут на него ответить.'),
    ('How do I change my profile picture or password?', 'account',
     'Профиль суретін немесе құпиясөзді қалай өзгертемін?',
     '«Баптаулар» бөліміне өтіңіз. Дайын аватарлардың бірін таңдауға немесе өз фотоңызды (2 МБ-қа дейін) жүктеуге болады. Құпиясөзді өзгерту үшін ағымдағы және жаңа құпиясөзді енгізіңіз.',
     'Как сменить фото профиля или пароль?',
     'Откройте «Настройки». Можно выбрать один из готовых аватаров или загрузить своё фото (до 2 МБ), а чтобы сменить пароль — ввести текущий пароль и новый.'),
    ('Can I use SDU Helpdesk in Kazakh or Russian?', 'general',
     'SDU Helpdesk-ті қазақ немесе орыс тілінде қолдануға бола ма?',
     'Иә — беттің жоғарғы жағындағы тіл таңдағышпен немесе «Баптаулар» бөлімінде English, Қазақша және Русский тілдерінің арасында ауыстырыңыз.',
     'Можно ли пользоваться SDU Helpdesk на казахском или русском?',
     'Да — переключайтесь между English, Қазақша и Русский в выборе языка вверху страницы или в «Настройках».')
) AS v(question, category, question_kz, answer_kz, question_ru, answer_ru)
WHERE f.question = v.question;
