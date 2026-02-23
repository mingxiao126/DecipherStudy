const fs = require('fs');
const path = require('path');

const users = ['daiyihang', 'zhusiyu'];
const baseDir = '/Users/ming/DecipherStudy/content';

users.forEach(user => {
  const userDir = path.join(baseDir, user);
  const oldTopicsPath = path.join(userDir, 'topics.json');
  const newTopicsPath = path.join(userDir, 'flashcard_topics.json');
  
  if (fs.existsSync(oldTopicsPath)) {
    const topics = JSON.parse(fs.readFileSync(oldTopicsPath, 'utf8'));
    
    topics.forEach(topic => {
      let oldFile = topic.file;
      if (!oldFile.startsWith('flashcard_')) {
        let newFile = 'flashcard_' + oldFile;
        topic.file = newFile;
        // Rename actual file
        let oldFilePath = path.join(userDir, oldFile);
        let newFilePath = path.join(userDir, newFile);
        if (fs.existsSync(oldFilePath)) {
          fs.renameSync(oldFilePath, newFilePath);
          console.log(`Renamed ${oldFile} to ${newFile} for user ${user}`);
        }
      }
    });
    
    fs.writeFileSync(newTopicsPath, JSON.stringify(topics, null, 2), 'utf8');
    fs.unlinkSync(oldTopicsPath);
    console.log(`Migrated topics for ${user}`);
  }

  const practiceTopicsPath = path.join(userDir, 'practice_topics.json');
  if (fs.existsSync(practiceTopicsPath)) {
    const practiceTopics = JSON.parse(fs.readFileSync(practiceTopicsPath, 'utf8'));
    const filtered = practiceTopics.filter(t => !t.file.startsWith('flashcard_'));
    fs.writeFileSync(practiceTopicsPath, JSON.stringify(filtered, null, 2), 'utf8');
    console.log(`Cleaned practice_topics for ${user} (removed flashcard items)`);
  }
});
