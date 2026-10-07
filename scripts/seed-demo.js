'use strict';
const config = require('../src/config');
const db = require('../src/db').open(config.dbFile);
const { seedDemo } = require('../src/db/demo');

seedDemo(db);
console.log('Đã tạo dữ liệu demo: danh bạ SSO giả lập + phân quyền mẫu.');
