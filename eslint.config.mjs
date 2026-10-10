import js from '@eslint/js';
import globals from 'globals';

/*
 * gemxin.com 静态站点 —— ESLint 扁平配置（flat config）
 *
 * 只校验本站自己写的脚本；assets/js/vendor 下的第三方库是原样引入的，
 * 不在校验范围内（也不应被格式化，见 .prettierignore）。
 *
 * 规则取向：以 @eslint/js 推荐集为底，再补几条本站明确要求的硬性项。
 * 缩进/引号/分号等纯格式交给 Prettier，避免两套工具互相打架。
 */
const sharedRules = {
	// 规范硬性项：不用 var、优先 const
	'no-var': 'error',
	'prefer-const': 'error',
	'prefer-template': 'error',

	// 明确意图：不用 ==（允许 x == null 这一惯用写法）
	eqeqeq: ['error', 'smart'],

	// 单行 if 也必须带花括号：本站大量使用「守卫 + 早返回」，避免歧义
	curly: ['error', 'all'],

	// 空 catch 一律禁止（要么记录，要么处理）
	'no-empty': ['error', { allowEmptyCatch: false }],
};

export default [
	{
		ignores: ['node_modules/**', 'assets/js/vendor/**'],
	},
	{
		// 站点脚本：浏览器环境
		files: ['assets/js/**/*.js'],
		...js.configs.recommended,
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'script',
			globals: globals.browser,
		},
		rules: {
			...js.configs.recommended.rules,
			...sharedRules,

			// console.warn/error 是给排查用的，允许；console.log 视为调试残留
			'no-console': ['error', { allow: ['warn', 'error'] }],
		},
	},
	{
		// 测试脚本：Node 环境，允许 console 输出（测试报告就靠它）
		files: ['tests/**/*.js'],
		...js.configs.recommended,
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			globals: {
				...globals.node,
				fetch: 'readonly',
				WebSocket: 'readonly',
			},
		},
		rules: {
			...js.configs.recommended.rules,
			...sharedRules,
			'no-console': 'off',
		},
	},
];
