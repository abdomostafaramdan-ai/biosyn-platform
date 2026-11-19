-- The owner's second personal account is also excluded from views and the public learner counter.
update app_settings set value = '{"emails":["abdomostafamohamedramdan@gmail.com","abdomostafamohamed651@gmail.com"]}' where key = 'view_exclude';
