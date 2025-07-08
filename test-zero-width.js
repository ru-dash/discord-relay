const MessageUtils = require('./src/utils/messageUtils');

// Test zero-width character removal
console.log('=== Zero-Width Character Handling Test ===');

// Test 1: Regular message
const regularMessage = 'Hello world!';
console.log('Test 1 - Regular message:');
console.log('Input:', JSON.stringify(regularMessage));
console.log('Output:', JSON.stringify(MessageUtils.removeZeroWidthChars(regularMessage)));
console.log('');

// Test 2: Message with zero-width characters
const messageWithZeroWidth = 'Hello\u200B\u200C\u200D world!';
console.log('Test 2 - Message with zero-width characters:');
console.log('Input:', JSON.stringify(messageWithZeroWidth));
console.log('Output:', JSON.stringify(MessageUtils.removeZeroWidthChars(messageWithZeroWidth)));
console.log('');

// Test 3: Message with only zero-width characters
const onlyZeroWidth = '\u200B\u200C\u200D\u2060\uFEFF';
console.log('Test 3 - Only zero-width characters:');
console.log('Input:', JSON.stringify(onlyZeroWidth));
console.log('Removed:', JSON.stringify(MessageUtils.removeZeroWidthChars(onlyZeroWidth)));
console.log('Sanitized:', JSON.stringify(MessageUtils.sanitizeMessage(onlyZeroWidth)));
console.log('');

// Test 4: Message with zero-width characters and whitespace
const zeroWidthWithWhitespace = '\u200B   \u200C\n\t\u200D   ';
console.log('Test 4 - Zero-width characters with whitespace:');
console.log('Input:', JSON.stringify(zeroWidthWithWhitespace));
console.log('Removed:', JSON.stringify(MessageUtils.removeZeroWidthChars(zeroWidthWithWhitespace)));
console.log('Sanitized:', JSON.stringify(MessageUtils.sanitizeMessage(zeroWidthWithWhitespace)));
console.log('');

// Test 5: Mixed content
const mixedContent = 'Hello\u200B world! @everyone check this out: https://example.com';
console.log('Test 5 - Mixed content with zero-width, mentions, and URL:');
console.log('Input:', JSON.stringify(mixedContent));
console.log('Sanitized:', JSON.stringify(MessageUtils.sanitizeMessage(mixedContent)));
console.log('');

console.log('=== Test Complete ===');
