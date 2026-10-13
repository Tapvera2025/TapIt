/**
 * Screening vocabulary: skill aliases, degree equivalences and fields of study.
 *
 * Plain keyword matching misses "k8s" for Kubernetes or "B.E." for B.Tech, and
 * over-matches "Go" or "C" in ordinary prose. Each entry lists STRONG aliases
 * (a mention is evidence) and WEAK aliases (ambiguous on their own — a mention
 * is reported as `uncertain` for a human to confirm).
 *
 * Criteria that are not in this vocabulary are still matched as literal phrases,
 * so HR is never limited to this list.
 */

export interface SkillEntry {
  readonly canonical: string;
  readonly aliases: readonly string[];
  readonly weak?: readonly string[];
}

export const SKILL_TAXONOMY: readonly SkillEntry[] = [
  // Languages
  { canonical: 'javascript', aliases: ['js', 'ecmascript', 'es6', 'es2015'] },
  { canonical: 'typescript', aliases: [], weak: ['ts'] },
  { canonical: 'python', aliases: ['python3', 'python 3'] },
  { canonical: 'java', aliases: ['core java', 'java ee', 'j2ee', 'jdk'] },
  { canonical: 'kotlin', aliases: [] },
  { canonical: 'swift', aliases: ['swiftui'] },
  { canonical: 'objective-c', aliases: ['objective c', 'objc'] },
  { canonical: 'golang', aliases: ['go lang', 'go language'], weak: ['go'] },
  { canonical: 'rust', aliases: [] },
  { canonical: 'c++', aliases: ['cpp', 'c plus plus'] },
  { canonical: 'c#', aliases: ['csharp', 'c sharp'] },
  { canonical: 'c', aliases: ['c programming', 'c language', 'ansi c', 'embedded c'], weak: ['c'] },
  { canonical: 'php', aliases: [] },
  { canonical: 'ruby', aliases: [] },
  { canonical: 'scala', aliases: [] },
  { canonical: 'r', aliases: ['r programming', 'r language', 'rstudio'], weak: ['r'] },
  { canonical: 'dart', aliases: [] },
  { canonical: 'sql', aliases: ['mysql', 'postgresql', 'postgres', 't-sql', 'tsql', 'pl/sql', 'plsql', 'sql server', 'mssql', 'sqlite', 'oracle sql'] },
  { canonical: 'bash', aliases: ['shell scripting', 'shell script', 'bash scripting'], weak: ['shell'] },

  // Front end
  { canonical: 'react', aliases: ['react.js', 'reactjs', 'react js'] },
  { canonical: 'react native', aliases: ['react-native'] },
  { canonical: 'angular', aliases: ['angularjs', 'angular.js', 'angular js'] },
  { canonical: 'vue', aliases: ['vue.js', 'vuejs', 'vue js', 'nuxt', 'nuxt.js'] },
  { canonical: 'next.js', aliases: ['nextjs', 'next js'] },
  { canonical: 'redux', aliases: ['redux toolkit'] },
  { canonical: 'html', aliases: ['html5'] },
  { canonical: 'css', aliases: ['css3', 'scss', 'sass', 'less'] },
  { canonical: 'tailwind css', aliases: ['tailwind', 'tailwindcss'] },
  { canonical: 'bootstrap', aliases: [] },
  { canonical: 'jquery', aliases: [] },
  { canonical: 'flutter', aliases: [] },
  { canonical: 'android', aliases: ['android sdk', 'android studio'] },
  { canonical: 'ios', aliases: ['iphone development'] },

  // Back end
  { canonical: 'node.js', aliases: ['nodejs', 'node js', 'node'] },
  { canonical: 'express.js', aliases: ['expressjs', 'express js'], weak: ['express'] },
  { canonical: 'nestjs', aliases: ['nest.js', 'nest js'] },
  { canonical: 'django', aliases: ['django rest framework', 'drf'] },
  { canonical: 'flask', aliases: [] },
  { canonical: 'fastapi', aliases: ['fast api'] },
  { canonical: 'spring boot', aliases: ['springboot', 'spring-boot'] },
  { canonical: 'spring', aliases: ['spring framework', 'spring mvc', 'spring boot'], weak: ['spring'] },
  { canonical: 'hibernate', aliases: ['jpa'] },
  { canonical: '.net', aliases: ['dotnet', 'asp.net', '.net core', '.net framework', 'asp.net core'] },
  { canonical: 'laravel', aliases: [] },
  { canonical: 'ruby on rails', aliases: ['rails', 'ror'] },
  { canonical: 'graphql', aliases: ['graph ql', 'apollo graphql'] },
  { canonical: 'rest api', aliases: ['rest apis', 'restful', 'restful api', 'restful apis', 'restful services', 'rest services'], weak: ['rest'] },
  { canonical: 'grpc', aliases: [] },
  { canonical: 'microservices', aliases: ['micro-services', 'microservice', 'micro services'] },

  // Data stores and messaging
  { canonical: 'postgresql', aliases: ['postgres', 'postgre sql', 'psql'] },
  { canonical: 'mysql', aliases: ['my sql', 'mariadb'] },
  { canonical: 'mongodb', aliases: ['mongo', 'mongo db', 'mongoose'] },
  { canonical: 'redis', aliases: [] },
  { canonical: 'elasticsearch', aliases: ['elastic search', 'elk', 'opensearch'] },
  { canonical: 'dynamodb', aliases: ['dynamo db'] },
  { canonical: 'cassandra', aliases: [] },
  { canonical: 'sql server', aliases: ['mssql', 'ms sql', 'microsoft sql server'] },
  { canonical: 'oracle database', aliases: ['oracle db', 'oracle sql', 'pl/sql', 'plsql'], weak: ['oracle'] },
  { canonical: 'firebase', aliases: ['firestore'] },
  { canonical: 'kafka', aliases: ['apache kafka'] },
  { canonical: 'rabbitmq', aliases: ['rabbit mq'] },
  { canonical: 'nosql', aliases: ['no-sql', 'no sql', 'mongodb', 'cassandra', 'dynamodb'] },

  // Cloud and DevOps
  { canonical: 'aws', aliases: ['amazon web services'], weak: ['ec2', 's3', 'lambda'] },
  { canonical: 'gcp', aliases: ['google cloud platform', 'google cloud'] },
  { canonical: 'azure', aliases: ['microsoft azure', 'azure devops'] },
  { canonical: 'docker', aliases: ['docker compose', 'docker-compose', 'containerization', 'containerisation'] },
  { canonical: 'kubernetes', aliases: ['k8s', 'eks', 'aks', 'gke', 'openshift', 'helm'] },
  { canonical: 'terraform', aliases: [] },
  { canonical: 'ansible', aliases: [] },
  { canonical: 'jenkins', aliases: [] },
  { canonical: 'github actions', aliases: [] },
  { canonical: 'ci/cd', aliases: ['cicd', 'ci-cd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment', 'github actions', 'gitlab ci', 'jenkins'] },
  { canonical: 'devops', aliases: ['dev ops'] },
  { canonical: 'git', aliases: ['github', 'gitlab', 'bitbucket'] },
  { canonical: 'linux', aliases: ['ubuntu', 'centos', 'rhel', 'red hat', 'debian'], weak: ['unix'] },
  { canonical: 'nginx', aliases: [] },

  // Quality
  { canonical: 'jest', aliases: [] },
  { canonical: 'cypress', aliases: [] },
  { canonical: 'selenium', aliases: ['selenium webdriver'] },
  { canonical: 'playwright', aliases: [] },
  { canonical: 'junit', aliases: [] },
  { canonical: 'pytest', aliases: [] },
  { canonical: 'unit testing', aliases: ['unit tests', 'unit test', 'tdd', 'test driven development', 'jest', 'junit', 'pytest', 'mocha', 'vitest'] },
  { canonical: 'manual testing', aliases: ['functional testing', 'regression testing'] },
  { canonical: 'automation testing', aliases: ['test automation', 'automated testing'] },

  // Data and AI
  { canonical: 'machine learning', aliases: ['ml', 'machine-learning'] },
  { canonical: 'deep learning', aliases: ['neural networks'], weak: ['dl'] },
  { canonical: 'artificial intelligence', aliases: ['ai'] },
  { canonical: 'generative ai', aliases: ['genai', 'gen ai', 'llm', 'llms', 'large language models', 'prompt engineering'] },
  { canonical: 'nlp', aliases: ['natural language processing'] },
  { canonical: 'computer vision', aliases: ['opencv', 'image processing'], weak: ['cv'] },
  { canonical: 'data science', aliases: ['data scientist'] },
  { canonical: 'data analysis', aliases: ['data analytics', 'data analyst', 'analytics'] },
  { canonical: 'pandas', aliases: [] },
  { canonical: 'numpy', aliases: [] },
  { canonical: 'scikit-learn', aliases: ['sklearn', 'scikit learn'] },
  { canonical: 'tensorflow', aliases: ['tensor flow', 'keras'] },
  { canonical: 'pytorch', aliases: ['torch'] },
  { canonical: 'power bi', aliases: ['powerbi', 'power-bi'] },
  { canonical: 'tableau', aliases: [] },
  { canonical: 'excel', aliases: ['ms excel', 'microsoft excel', 'advanced excel', 'vlookup', 'pivot tables', 'pivot table'] },
  { canonical: 'google sheets', aliases: [] },
  { canonical: 'etl', aliases: ['data pipelines', 'data pipeline'] },
  { canonical: 'spark', aliases: ['apache spark', 'pyspark'] },

  // Design
  { canonical: 'figma', aliases: [] },
  { canonical: 'adobe xd', aliases: [] },
  { canonical: 'photoshop', aliases: ['adobe photoshop'] },
  { canonical: 'illustrator', aliases: ['adobe illustrator'] },
  { canonical: 'canva', aliases: [] },
  { canonical: 'ui/ux', aliases: ['ui ux', 'ux design', 'ui design', 'user experience', 'user interface design', 'ux'] },

  // Delivery and ways of working
  { canonical: 'agile', aliases: ['scrum', 'kanban', 'sprint planning'] },
  { canonical: 'scrum', aliases: ['scrum master'] },
  { canonical: 'jira', aliases: [] },
  { canonical: 'project management', aliases: ['pmp', 'program management', 'project planning'] },
  { canonical: 'stakeholder management', aliases: ['stakeholder communication'] },

  // Sales, marketing and business
  { canonical: 'crm', aliases: ['customer relationship management', 'salesforce', 'hubspot', 'zoho crm'] },
  { canonical: 'salesforce', aliases: ['sfdc'] },
  { canonical: 'hubspot', aliases: [] },
  { canonical: 'zoho', aliases: ['zoho crm', 'zoho books'] },
  { canonical: 'lead generation', aliases: ['lead gen', 'prospecting'] },
  { canonical: 'b2b sales', aliases: ['b2b', 'enterprise sales'] },
  { canonical: 'inside sales', aliases: ['tele sales', 'telesales', 'telecalling', 'tele-calling'] },
  { canonical: 'cold calling', aliases: ['cold calls', 'cold-calling'] },
  { canonical: 'business development', aliases: ['biz dev'], weak: ['bd', 'bde'] },
  { canonical: 'negotiation', aliases: ['negotiating', 'negotiations'] },
  { canonical: 'account management', aliases: ['key account management', 'client servicing'] },
  { canonical: 'digital marketing', aliases: ['online marketing', 'performance marketing'] },
  { canonical: 'seo', aliases: ['search engine optimization', 'search engine optimisation'] },
  { canonical: 'sem', aliases: ['search engine marketing', 'ppc', 'pay per click'] },
  { canonical: 'google ads', aliases: ['adwords', 'google adwords'] },
  { canonical: 'google analytics', aliases: ['ga4'] },
  { canonical: 'social media marketing', aliases: ['smm', 'social media management', 'instagram marketing'] },
  { canonical: 'content writing', aliases: ['copywriting', 'content creation', 'blog writing', 'copy writing'] },
  { canonical: 'email marketing', aliases: ['mailchimp', 'email campaigns'] },
  { canonical: 'market research', aliases: ['competitor analysis', 'competitive analysis'] },

  // HR, finance and operations
  { canonical: 'recruitment', aliases: ['recruiting', 'talent acquisition', 'sourcing', 'end-to-end recruitment'], weak: ['hiring'] },
  { canonical: 'payroll', aliases: ['payroll processing', 'payroll management'] },
  { canonical: 'onboarding', aliases: ['employee onboarding', 'induction'] },
  { canonical: 'hrms', aliases: ['hris', 'hr software', 'darwinbox', 'keka', 'greythr'] },
  { canonical: 'employee engagement', aliases: [] },
  { canonical: 'statutory compliance', aliases: ['pf', 'esi', 'esic', 'labour law', 'labor law'] },
  { canonical: 'accounting', aliases: ['accounts', 'bookkeeping', 'book keeping'] },
  { canonical: 'tally', aliases: ['tally erp', 'tally prime', 'tally erp 9'] },
  { canonical: 'gst', aliases: ['goods and services tax', 'gst filing', 'gst returns'] },
  { canonical: 'taxation', aliases: ['income tax', 'tds', 'direct tax', 'indirect tax'] },
  { canonical: 'financial analysis', aliases: ['financial modelling', 'financial modeling'] },
  { canonical: 'sap', aliases: ['sap fico', 'sap mm', 'sap sd', 'sap hana', 's/4hana'] },
  { canonical: 'erp', aliases: ['enterprise resource planning'] },
  { canonical: 'customer support', aliases: ['customer service', 'client support', 'helpdesk', 'help desk', 'technical support'] },

  // Professional skills
  { canonical: 'communication', aliases: ['communication skills', 'verbal communication', 'written communication'] },
  { canonical: 'leadership', aliases: ['team leadership', 'led a team', 'team lead', 'people management'] },
  { canonical: 'teamwork', aliases: ['team work', 'team player', 'collaboration'] },
  { canonical: 'problem solving', aliases: ['problem-solving', 'analytical skills'] },
  { canonical: 'english', aliases: ['english proficiency', 'fluent in english'] },
  { canonical: 'hindi', aliases: [] },
];

/* ------------------------------------------------------------------ *
 * Qualifications
 * ------------------------------------------------------------------ */

export type DegreeFamily =
  | 'engineering' | 'computer-applications' | 'science' | 'commerce' | 'arts'
  | 'management' | 'law' | 'medicine' | 'pharmacy' | 'architecture' | 'general';

export interface DegreeEntry {
  readonly id: string;
  readonly label: string;
  /** 1 higher secondary · 2 diploma · 3 bachelor · 4 master · 5 doctorate */
  readonly level: number;
  readonly family: DegreeFamily;
  readonly aliases: readonly string[];
  readonly weak?: readonly string[];
  /** A generic level ("Bachelor's degree", "Any graduate") is met by any degree at or above it. */
  readonly generic?: boolean;
}

export const DEGREE_TAXONOMY: readonly DegreeEntry[] = [
  { id: 'phd', label: 'PhD', level: 5, family: 'general', aliases: ['phd', 'ph.d', 'ph.d.', 'ph. d', 'doctorate', 'doctor of philosophy', 'd.phil'] },

  { id: 'mtech', label: 'M.Tech / M.E.', level: 4, family: 'engineering', aliases: ['m.tech', 'mtech', 'm tech', 'm.e.', 'master of technology', 'master of engineering', 'masters in engineering'], weak: ['me'] },
  { id: 'mca', label: 'MCA', level: 4, family: 'computer-applications', aliases: ['mca', 'master of computer applications', 'master of computer application', 'masters in computer applications'] },
  { id: 'mba', label: 'MBA / PGDM', level: 4, family: 'management', aliases: ['mba', 'pgdm', 'pgdbm', 'master of business administration', 'post graduate diploma in management', 'post-graduate diploma in management', 'executive mba'] },
  { id: 'msc', label: 'M.Sc / M.S.', level: 4, family: 'science', aliases: ['m.sc', 'm.sc.', 'msc', 'm sc', 'master of science', 'masters of science', "master's of science", 'm.s.'], weak: ['ms'] },
  { id: 'mcom', label: 'M.Com', level: 4, family: 'commerce', aliases: ['m.com', 'mcom', 'm com', 'master of commerce'] },
  { id: 'ma', label: 'M.A.', level: 4, family: 'arts', aliases: ['m.a.', 'master of arts', 'masters of arts'], weak: ['ma'] },
  { id: 'llm', label: 'LL.M', level: 4, family: 'law', aliases: ['ll.m', 'llm', 'master of laws'] },
  { id: 'master', label: "Master's degree", level: 4, family: 'general', generic: true, aliases: ['master', 'masters', "master's", 'post graduate', 'postgraduate', 'post-graduate', 'post graduation', 'postgraduation'], weak: ['pg'] },

  { id: 'btech', label: 'B.Tech / B.E.', level: 3, family: 'engineering', aliases: ['b.tech', 'btech', 'b tech', 'b.e.', 'b.e', 'bachelor of technology', 'bachelor of engineering', 'bachelors in engineering', 'bachelors of engineering', 'bachelors of technology'], weak: ['be'] },
  { id: 'bca', label: 'BCA', level: 3, family: 'computer-applications', aliases: ['bca', 'bachelor of computer applications', 'bachelor of computer application'] },
  { id: 'bba', label: 'BBA / BBM', level: 3, family: 'management', aliases: ['bba', 'bbm', 'bms', 'bachelor of business administration', 'bachelor of business management', 'bachelor of management studies'] },
  { id: 'bsc', label: 'B.Sc / B.S.', level: 3, family: 'science', aliases: ['b.sc', 'b.sc.', 'bsc', 'b sc', 'bachelor of science', 'bachelors of science', "bachelor's of science", 'b.s.'], weak: ['bs'] },
  { id: 'bcom', label: 'B.Com', level: 3, family: 'commerce', aliases: ['b.com', 'bcom', 'b com', 'bachelor of commerce'] },
  { id: 'ba', label: 'B.A.', level: 3, family: 'arts', aliases: ['b.a.', 'bachelor of arts', 'bachelors of arts'], weak: ['ba'] },
  { id: 'barch', label: 'B.Arch', level: 3, family: 'architecture', aliases: ['b.arch', 'barch', 'bachelor of architecture'] },
  { id: 'llb', label: 'LL.B', level: 3, family: 'law', aliases: ['ll.b', 'llb', 'bachelor of laws', 'ba llb', 'bba llb'] },
  { id: 'mbbs', label: 'MBBS', level: 3, family: 'medicine', aliases: ['mbbs', 'bachelor of medicine'] },
  { id: 'bpharm', label: 'B.Pharm', level: 3, family: 'pharmacy', aliases: ['b.pharm', 'bpharm', 'bachelor of pharmacy'] },
  { id: 'bachelor', label: "Bachelor's degree", level: 3, family: 'general', generic: true, aliases: ['bachelor', 'bachelors', "bachelor's", 'graduate', 'graduation', 'undergraduate', 'any graduate', 'graduate degree', 'degree'], weak: ['ug'] },

  { id: 'diploma', label: 'Diploma', level: 2, family: 'general', generic: true, aliases: ['diploma', 'polytechnic'] },
  { id: 'hsc', label: 'Higher secondary (12th)', level: 1, family: 'general', generic: true, aliases: ['12th', 'xii', 'class xii', 'class 12', 'hsc', 'higher secondary', 'senior secondary', 'intermediate', 'puc', '10+2'] },
];

/** Fields of study, for requirements such as "B.Tech in Computer Science". */
export const FIELD_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  'computer science': ['computer science', 'cse', 'cs', 'computer engineering', 'computer science and engineering', 'computer science & engineering', 'computing'],
  'information technology': ['information technology', 'it'],
  'electronics': ['electronics', 'ece', 'electronics and communication', 'electronics & communication', 'entc', 'e&tc'],
  'electrical': ['electrical', 'eee', 'electrical and electronics', 'electrical & electronics'],
  'mechanical': ['mechanical'],
  'civil': ['civil'],
  'commerce': ['commerce', 'accounting', 'accountancy', 'finance'],
  'finance': ['finance', 'financial'],
  'marketing': ['marketing'],
  'human resources': ['human resources', 'human resource', 'hr', 'hrm', 'personnel management'],
  'business administration': ['business administration', 'management', 'business'],
  'mathematics': ['mathematics', 'maths', 'math', 'statistics'],
  'statistics': ['statistics', 'statistical'],
  'design': ['design', 'fine arts'],
};

/** Professional certifications with common short forms. */
export const CERTIFICATION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'pmp': ['pmp', 'project management professional'],
  'chartered accountant': ['chartered accountant', 'aca', 'fca', 'ca inter', 'ca final'],
  'cfa': ['cfa', 'chartered financial analyst'],
  'cpa': ['cpa', 'certified public accountant'],
  'aws certified': ['aws certified', 'aws certification', 'aws solutions architect', 'aws developer associate'],
  'csm': ['csm', 'certified scrum master', 'certified scrummaster'],
  'shrm': ['shrm-cp', 'shrm-scp', 'shrm'],
  'istqb': ['istqb'],
};
