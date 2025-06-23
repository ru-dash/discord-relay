import os
import sqlite3
from collections import defaultdict

def search_sqlite_files(directory):
    """Recursively search for SQLite files in the directory."""
    sqlite_files = []
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(".db"):
                sqlite_files.append(os.path.join(root, file))
    return sqlite_files

def create_central_database():
    """Create a fresh central database to combine all data."""
    central_db_path = "central.db"
    if os.path.exists(central_db_path):
        os.remove(central_db_path)  # Ensure a fresh database each time

    connection = sqlite3.connect(central_db_path)
    cursor = connection.cursor()

    # Create a table to store combined channel members
    cursor.execute(
        """
        CREATE TABLE channel_members (
            userId TEXT,
            displayName TEXT,
            guildId TEXT,
            guildName TEXT,
            roles TEXT,
            status TEXT,
            platforms TEXT,
            sourceDb TEXT
        )
        """
    )

    connection.commit()
    connection.close()
    return central_db_path

def populate_central_database(central_db_path, sqlite_files):
    """Populate the central database with data from all SQLite files."""
    central_connection = sqlite3.connect(central_db_path)
    central_cursor = central_connection.cursor()

    for db_path in sqlite_files:
        try:
            source_connection = sqlite3.connect(db_path)
            source_cursor = source_connection.cursor()

            # Fetch all data from the channel_members table in the source database
            source_cursor.execute("SELECT userId, displayName, guildId, guildName, roles, status, platforms FROM channel_members")
            rows = source_cursor.fetchall()

            # Append source database identifier
            rows_with_source = [(row[0], row[1], row[2], row[3], row[4], row[5], row[6], db_path) for row in rows]

            # Insert data into the central database
            central_cursor.executemany(
                "INSERT INTO channel_members (userId, displayName, guildId, guildName, roles, status, platforms, sourceDb) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                rows_with_source
            )

            source_connection.close()
        except sqlite3.Error as e:
            print(f"Error accessing database {db_path}: {e}")

    central_connection.commit()
    central_connection.close()

def display_guilds(central_db_path):
    """Display all unique guilds and their IDs."""
    try:
        connection = sqlite3.connect(central_db_path)
        cursor = connection.cursor()

        query = "SELECT DISTINCT guildId, guildName FROM channel_members"
        cursor.execute(query)
        results = cursor.fetchall()

        print("\nAvailable Guilds:")
        guilds = []
        for guild_id, guild_name in results:
            guilds.append((guild_id, guild_name))
            print(f"  - Guild Name: {guild_name} (ID: {guild_id})")

        connection.close()
        return guilds
    except sqlite3.Error as e:
        print(f"Error displaying guilds: {e}")
        return []

def find_users_in_selected_guilds(central_db_path, guild_a, guild_b):
    """Find users who are in both selected guilds and display their names in each guild."""
    try:
        connection = sqlite3.connect(central_db_path)
        cursor = connection.cursor()

        query_a = """
        SELECT DISTINCT userId, displayName
        FROM channel_members
        WHERE guildId = ?
        """

        query_b = """
        SELECT DISTINCT userId, displayName
        FROM channel_members
        WHERE guildId = ?
        """

        cursor.execute(query_a, (guild_a,))
        guild_a_users = {row[0]: row[1] for row in cursor.fetchall()}

        cursor.execute(query_b, (guild_b,))
        guild_b_users = {row[0]: row[1] for row in cursor.fetchall()}

        common_users = set(guild_a_users.keys()) & set(guild_b_users.keys())

        if common_users:
            print(f"\nUsers in both Guild {guild_a} and Guild {guild_b}:")
            for user_id in common_users:
                print(f"  - User ID: {user_id}")
                print(f"    Display Name in Guild {guild_a}: {guild_a_users[user_id]}")
                print(f"    Display Name in Guild {guild_b}: {guild_b_users[user_id]}")
        else:
            print(f"\nNo users found in both Guild {guild_a} and Guild {guild_b}.")

        connection.close()
    except sqlite3.Error as e:
        print(f"Error finding users in selected guilds: {e}")

def main():
    print("Searching for SQLite files...")
    directory = os.getcwd()
    sqlite_files = search_sqlite_files(directory)

    if not sqlite_files:
        print("No SQLite files found.")
        return

    print(f"Found {len(sqlite_files)} SQLite files.")

    # Create a fresh central database
    central_db_path = create_central_database()

    # Populate the central database with data from all SQLite files
    populate_central_database(central_db_path, sqlite_files)

    # Display all guilds
    guilds = display_guilds(central_db_path)

    if not guilds:
        print("No guilds available to compare.")
        return

    # Prompt user for guilds to compare
    guild_a = input("Enter the Guild ID for Guild A: ").strip()
    guild_b = input("Enter the Guild ID for Guild B: ").strip()

    # Find users in both selected guilds
    find_users_in_selected_guilds(central_db_path, guild_a, guild_b)

if __name__ == "__main__":
    main()

